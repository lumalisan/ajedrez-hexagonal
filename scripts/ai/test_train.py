"""Small CPU regressions: python -B scripts/ai/test_train.py."""

import json
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

import numpy as np

import train


class TrainingTests(unittest.TestCase):
    def test_feature_schema_and_dimensions_are_exact_supported_pairs(self):
        self.assertEqual(train.FEATURE_SCHEMA, "hex-sparse-v1")
        self.assertEqual(train.INPUT_SIZE, 5183)
        self.assertEqual(train.validate_feature_contract("hex-sparse-v1", 5183), 5183)
        self.assertEqual(train.validate_feature_contract("hex-sparse-v2", 5203), 5203)
        row = {"kind": "sample", "gameId": "g1", "features": [5202], "teacher": 0, "outcome": None}
        path = self.dataset([row], {"schema": "hex-sparse-v2", "inputSize": 5203})
        header, samples = train.read_dataset(path, None)
        self.assertEqual(header["inputSize"], 5203)
        self.assertEqual(samples[0].features, (5202,))
        for schema, size in [("hex-sparse-v1", 5203), ("hex-sparse-v2", 5183), ("hex-sparse-v3", 5203), ("hex-sparse-v1", 5183.0)]:
            with self.subTest(schema=schema, size=size):
                path = self.dataset([row], {"schema": schema, "inputSize": size})
                with self.assertRaisesRegex(ValueError, "incompatible"):
                    train.read_dataset(path, None)
        path = self.dataset([{**row, "features": [5203]}], {"schema": "hex-sparse-v2", "inputSize": 5203})
        with self.assertRaisesRegex(ValueError, "índice inválido"):
            train.read_dataset(path, None)

    def test_v1_warm_start_extends_v2_with_zero_rows_and_preserves_predictions(self):
        parameters = train.initial_parameters(19, 3, 0)
        metadata = {"format": "hex-value-v1", "featureSchema": train.FEATURE_SCHEMA,
                    "inputSize": train.INPUT_SIZE, "hiddenSizes": [64, 32], "outputScale": 10000,
                    "evaluation": "classic-residual-v1", "residualScale": 2000,
                    "residualSymmetry": "antisymmetric"}
        path = self.folder / "old.bin"
        train.export_model(path, parameters, metadata)
        header = {"schema": "hex-sparse-v2", "inputSize": 5203, "target": "classic-residual-v1", "residualScale": 2000}
        transfer = {}
        expanded = train.read_initial_model(path, header, True, transfer)
        self.assertEqual(expanded["w1"].shape, (5203, 64))
        np.testing.assert_array_equal(expanded["w1"][:5183], parameters["w1"])
        np.testing.assert_array_equal(expanded["w1"][5183:], np.zeros((20, 64), dtype=np.float32))
        for name in train.PARAMETER_NAMES[1:]:
            np.testing.assert_array_equal(expanded[name], parameters[name])
        rng = np.random.default_rng(29)
        for count in (1, 5, 25, 80):
            base = tuple(sorted(rng.choice(np.arange(5183), count, replace=False).tolist()))
            upgraded = (*base, 5183, 5188, 5202)
            np.testing.assert_array_equal(train.predict(parameters, [base]), train.predict(expanded, [upgraded]))
        self.assertEqual(transfer["mode"], "zero-extended-v1-to-v2")
        self.assertEqual(transfer["newFeatureRows"], 20)
        self.assertEqual(transfer["sourceModelSha256"], train.file_digest(path))
        self.assertTrue(transfer["preservesInitialFunction"])

        upgraded_path = self.folder / "new.bin"
        train.export_model(upgraded_path, expanded, {**metadata, "featureSchema": "hex-sparse-v2", "inputSize": 5203})
        restored_transfer = {}
        restored = train.read_initial_model(upgraded_path, header, True, restored_transfer)
        self.assertEqual(restored_transfer["mode"], "exact-schema")
        for name in train.PARAMETER_NAMES:
            np.testing.assert_array_equal(restored[name], expanded[name])
        with self.assertRaisesRegex(ValueError, "truncaría"):
            train.read_initial_model(upgraded_path, {**header, "schema": "hex-sparse-v1", "inputSize": 5183}, True)

    def test_v2_cli_exports_dynamic_model_and_parity_with_transfer_provenance(self):
        parameters = train.initial_parameters(19, 3, 0)
        initial = self.folder / "initial-v1.bin"
        metadata = {"format": "hex-value-v1", "featureSchema": train.FEATURE_SCHEMA,
                    "inputSize": train.INPUT_SIZE, "hiddenSizes": [64, 32], "outputScale": 10000,
                    "evaluation": "classic-residual-v1", "residualScale": 2000,
                    "residualSymmetry": "antisymmetric"}
        train.export_model(initial, parameters, metadata)
        rows = [{"kind": "sample", "gameId": f"g{index // 2}", "ply": 10,
                 "perspective": index % 2, "features": [index % 2, 5183 + index % 2, 5202],
                 "teacher": 0.2 if index % 2 == 0 else -0.2, "outcome": None}
                for index in range(20)]
        path = self.dataset(rows, {"schema": "hex-sparse-v2", "inputSize": 5203,
                                   "target": "classic-residual-v1", "residualScale": 2000})
        output = self.folder / "trained-v2.bin"
        with patch("sys.argv", ["train.py", "--input", str(path), "--output", str(output),
                                "--initialize-model", str(initial), "--epochs", "1", "--antisymmetric", "--teacher-weight", "1"]), redirect_stdout(StringIO()):
            self.assertEqual(train.main(), 0)
        raw = output.read_bytes()
        length = int.from_bytes(raw[4:8], "little")
        exported = json.loads(raw[8:8 + length])
        self.assertEqual(exported["featureSchema"], "hex-sparse-v2")
        self.assertEqual(exported["inputSize"], 5203)
        report = json.loads(Path(str(output) + ".training.json").read_text())
        self.assertEqual(report["initialModelTransfer"]["newFeatureRows"], 20)
        self.assertEqual(report["initialModelTransfer"]["sourceModelSha256"], report["initialModel"]["sha256"])
        parity = json.loads(Path(str(output) + ".parity.json").read_text())
        self.assertEqual(parity["featureSchema"], "hex-sparse-v2")
        self.assertEqual(parity["inputSize"], 5203)
        self.assertIn(5202, parity["vectors"][0]["features"])
        self.assertEqual(train.initial_parameters(19, 3, 0, input_size=5203)["w1"].shape, (5203, 64))

    def test_teacher_stability_weights_require_real_probe_metadata(self):
        self.assertEqual(train.teacher_stability_weight({}, 500), 1)
        self.assertEqual(train.teacher_stability_weight({"confidence": {"probeUsable": False}}, 500), 1)
        self.assertEqual(train.teacher_stability_weight({"confidence": {"probeUsable": True, "absoluteScoreDelta": 500}}, 500), 0.5)
        self.assertEqual(train.teacher_stability_weight({"confidence": {"probeUsable": True, "absoluteScoreDelta": 1e9}}, 500), 0.05)
        for delta in (None, -1, True, float("nan")):
            with self.subTest(delta=delta), self.assertRaisesRegex(ValueError, "absoluteScoreDelta"):
                train.teacher_stability_weight({"confidence": {"probeUsable": True, "absoluteScoreDelta": delta}}, 500)

    def test_weighted_projected_gradients_match_finite_differences(self):
        features = [(0, 2, 4), (1, 3, 5), (6, 8), (7, 9)]
        target = np.array([0.4, -0.4, 0.01, -0.01], dtype=np.float32)
        weights = np.array([0.2, 0.2, 0.9, 0.9], dtype=np.float32)
        partners = [1, 0, 3, 2]
        for objective in ("mse", "huber"):
            with self.subTest(objective=objective):
                parameters = train.initial_parameters(19, 3, 0)
                parameters["b1"][:] = 0.3
                parameters["b2"][:] = 0.3
                def loss():
                    output = train.predict(parameters, features)
                    return train.regression_loss((output - output[partners]) / 2, target, objective, 0.1, weights)
                numerical = {}
                for name, index in [("w3", (0,)), ("w2", (0, 0)), ("w1", (0, 0)), ("b3", (0,))]:
                    original = parameters[name][index].copy()
                    parameters[name][index] = original + 0.001
                    high = loss()
                    parameters[name][index] = original - 0.001
                    low = loss()
                    parameters[name][index] = original
                    numerical[(name, index)] = (high - low) / 0.002
                backend = train.NumpyBackend(parameters, 0.0002, 0, objective, 0.1)
                backend.train_batch(features, target, partners, weights)
                for (name, index), expected in numerical.items():
                    self.assertAlmostEqual(float(backend.first_moment[name][index] / 0.1), expected, delta=0.0001)
        stats = train.weight_statistics(weights)
        self.assertLess(stats["effectiveSampleSize"], len(weights))
        self.assertEqual(stats["downweightedSamples"], 4)

    def test_family_split_keeps_trajectories_together_and_subsets_whole_families(self):
        samples = [train.Sample(f"game-{index}", (index,), 0, None, group_id=f"family-{index // 3}") for index in range(60)]
        training, validation, split = train.split_games(samples, 17, 0.2, "hash-threshold", "familyId")
        self.assertTrue(set(split["trainingGroups"]).isdisjoint(split["validationGroups"]))
        self.assertEqual(len(training) % 3, 0)
        self.assertEqual(len(validation) % 3, 0)
        subset, details = train.select_training_games(samples, training, 2, 17, "familyId")
        self.assertEqual(len(subset), 6)
        self.assertEqual(details["selectedGroups"], 2)
        self.assertEqual(details["selectedGames"], 6)
        self.assertEqual(details["selectionUnit"], "familyId")
        summary = train.split_summary(split)
        self.assertEqual(summary["groupField"], "familyId")
        self.assertEqual(summary["validationGroupCount"], len(split["validationGroups"]))

    def test_family_ids_are_required_and_consistent_when_requested(self):
        row = {"kind": "sample", "gameId": "g1", "features": [1], "teacher": 0, "outcome": None}
        path = self.dataset([row])
        with self.assertRaisesRegex(ValueError, "familyId"):
            train.read_dataset(path, None, split_group_field="familyId")
        path = self.dataset([{**row, "familyId": "a"}, {**row, "familyId": "b"}])
        with self.assertRaisesRegex(ValueError, "coherente"):
            train.read_dataset(path, None, split_group_field="familyId")
        _, samples = train.read_dataset(path, None)
        self.assertIsNone(samples[0].group_id)

    def test_paired_weights_must_match_and_validation_selection_stays_unweighted(self):
        rows = [{"kind": "sample", "gameId": f"g{index // 2}", "ply": 10,
                 "perspective": index % 2, "features": [1 + index % 2],
                 "teacher": 0.2 if index % 2 == 0 else -0.2, "outcome": None,
                 "confidence": {"probeUsable": True, "absoluteScoreDelta": (index // 2) * 200}}
                for index in range(20)]
        path = self.dataset(rows, {"target": "classic-residual-v1", "residualScale": 2000})
        output = self.folder / "weighted.bin"
        arguments = ["train.py", "--input", str(path), "--output", str(output),
                     "--epochs", "1", "--antisymmetric", "--teacher-weight", "1", "--sample-weighting", "teacher-stability"]
        with patch("sys.argv", arguments), redirect_stdout(StringIO()):
            self.assertEqual(train.main(), 0)
        report = json.loads(Path(str(output) + ".training.json").read_text())
        self.assertEqual(report["selectionMetric"], "validation-mse")
        self.assertFalse(report["sampleWeighting"]["validationSelectionWeighted"])
        self.assertLess(report["sampleWeighting"]["training"]["effectiveSampleSize"], report["split"]["trainingSamples"])
        rows[1]["confidence"]["absoluteScoreDelta"] = 100
        path = self.dataset(rows, {"target": "classic-residual-v1", "residualScale": 2000})
        with patch("sys.argv", arguments), redirect_stdout(StringIO()), self.assertRaisesRegex(ValueError, "mismo peso"):
            train.main()

    def test_huber_loss_and_gradient_cap_outliers_in_normalized_units(self):
        actual = np.array([0.05, 0.5, -0.5], dtype=np.float32)
        expected = np.zeros(3, dtype=np.float32)
        self.assertAlmostEqual(train.regression_loss(actual, expected, "huber", 0.1), (0.00125 + 0.045 + 0.045) / 3)
        np.testing.assert_allclose(train.regression_gradient(actual, expected, "huber", 0.1), np.array([0.05, 0.1, -0.1]) / 3)
        self.assertEqual(train.regression_loss(actual, expected), train.mse(actual, expected))
        np.testing.assert_allclose(train.regression_gradient(actual, expected), 2 * actual / 3)

    def test_huber_projected_and_raw_gradients_match_finite_differences(self):
        features = [(0, 2, 4), (1, 3, 5)]
        for partners in (None, [1, 0]):
            for target_value in (0.01, 0.4):
                with self.subTest(partners=partners, target=target_value):
                    target = np.array([target_value, -target_value], dtype=np.float32)
                    parameters = train.initial_parameters(19, 3, 0)
                    parameters["b1"][:] = 0.3
                    parameters["b2"][:] = 0.3
                    def loss():
                        output = train.predict(parameters, features)
                        projected = output if partners is None else (output - output[partners]) / 2
                        return train.regression_loss(projected, target, "huber", 0.1)
                    numerical = {}
                    for name, index in [("w3", (0,)), ("w2", (0, 0)), ("w1", (0, 0)), ("b3", (0,))]:
                        original = parameters[name][index].copy()
                        parameters[name][index] = original + 0.001
                        high = loss()
                        parameters[name][index] = original - 0.001
                        low = loss()
                        parameters[name][index] = original
                        numerical[(name, index)] = (high - low) / 0.002
                    backend = train.NumpyBackend(parameters, 0.0002, 0, "huber", 0.1)
                    backend.train_batch(features, target, partners)
                    for (name, index), expected in numerical.items():
                        self.assertAlmostEqual(float(backend.first_moment[name][index] / 0.1), expected, delta=0.0001)

    @unittest.skipUnless(importlib.util.find_spec("torch"), "PyTorch opcional no instalado")
    def test_torch_and_numpy_huber_projected_gradients_agree(self):
        features = [(0, 2, 4), (1, 3, 5)]
        target = np.array([0.4, -0.4], dtype=np.float32)
        parameters = train.initial_parameters(19, 3, 0)
        parameters["b1"][:] = 0.3
        parameters["b2"][:] = 0.3
        numpy_backend = train.NumpyBackend({name: value.copy() for name, value in parameters.items()}, 0.0002, 0, "huber", 0.1)
        torch_backend = train.TorchBackend(parameters, 0.0002, 0, "huber", 0.1)
        numpy_backend.train_batch(features, target, [1, 0])
        torch_backend.train_batch(features, target, [1, 0])
        for name in parameters:
            np.testing.assert_allclose(numpy_backend.first_moment[name] / 0.1, torch_backend.parameters[name].grad.detach().numpy(), atol=1e-7)

    def test_training_subsets_are_nested_keep_games_whole_and_leave_validation_intact(self):
        samples = [train.Sample(f"game-{index // 4}", (index,), 0, None) for index in range(120)]
        training, validation, original = train.split_games(samples, 17, 0.2, "hash-threshold")
        small, small_details = train.select_training_games(samples, training, 3, 17)
        larger, _ = train.select_training_games(samples, training, 7, 17)
        reordered, _ = train.select_training_games(samples, list(reversed(training)), 3, 17)
        self.assertEqual(set(small), set(reordered))
        self.assertTrue(set(small).issubset(larger))
        self.assertTrue(set(small).isdisjoint(validation))
        self.assertEqual(len(small), 12)
        self.assertEqual(small_details["selectedGames"], 3)
        all_training, details = train.select_training_games(samples, training, None, 17)
        self.assertEqual(all_training, training)
        self.assertEqual(details["selectedGames"], len(original["trainingGames"]))
        _, repeated_validation, repeated_split = train.split_games(samples, 17, 0.2, "hash-threshold")
        self.assertEqual(validation, repeated_validation)
        self.assertEqual(original, repeated_split)

    def test_feature_conflicts_report_unlearnable_label_variance(self):
        samples = [train.Sample("g1", (0, 2), 0.2, None),
                   train.Sample("g2", (2, 0), -0.2, None),
                   train.Sample("g3", (1,), 0.9, None)]
        report = train.feature_conflicts(samples, [0, 1, 2], train.targets(samples, 1))
        self.assertEqual(report["uniqueFeatureVectors"], 2)
        self.assertEqual(report["conflictingFeatureVectors"], 1)
        self.assertAlmostEqual(report["maximumTargetRange"], 0.4)
        self.assertAlmostEqual(report["identicalFeaturesMseFloor"], 0.08 / 3)

    def test_huber_cli_keeps_mse_selection_and_validation_with_training_subset(self):
        rows = [{"kind": "sample", "gameId": f"g{index // 2}", "ply": 10,
                 "perspective": index % 2, "features": [1 + index % 2],
                 "teacher": 0.2 if index % 2 == 0 else -0.2, "outcome": None}
                for index in range(40)]
        path = self.dataset(rows, {"target": "classic-residual-v1", "residualScale": 2000})
        _, samples = train.read_dataset(path, None)
        _, expected_validation, _ = train.split_games(samples, 19, 0.2)
        output = self.folder / "huber.bin"
        with patch("sys.argv", ["train.py", "--input", str(path), "--output", str(output),
                                "--epochs", "1", "--seed", "19", "--antisymmetric", "--teacher-weight", "1",
                                "--loss", "huber", "--huber-delta", "0.1", "--max-training-games", "3"]), redirect_stdout(StringIO()):
            self.assertEqual(train.main(), 0)
        report = json.loads(Path(str(output) + ".training.json").read_text())
        self.assertEqual(report["selectionMetric"], "validation-mse")
        self.assertEqual(report["trainingObjective"], "projected-paired-perspectives-huber")
        self.assertEqual(report["optimizationLoss"], {"name": "huber", "huberDelta": 0.1})
        self.assertEqual(report["split"]["validationSamples"], len(expected_validation))
        self.assertEqual(len(report["split"]["trainingGames"]), 3)
        self.assertEqual(report["trainingSubset"]["selectedGames"], 3)
        self.assertIn("validationObjectiveLoss", report["history"][0])

    def test_threshold_split_never_moves_old_training_games_into_validation(self):
        samples = [train.Sample(f"game-{index}", (index,), 0, None) for index in range(100)]
        _, _, first = train.split_games(samples[:30], 17, 0.2, "hash-threshold")
        _, _, extended = train.split_games(samples, 17, 0.2, "hash-threshold")
        self.assertTrue(set(first["trainingGames"]).issubset(extended["trainingGames"]))
        self.assertTrue(set(first["validationGames"]).issubset(extended["validationGames"]))
        self.assertEqual(first["method"], "sha256-game-id-threshold")

    def test_projected_gradient_matches_finite_differences(self):
        features = [(0, 2, 4), (1, 3, 5)]
        target = np.array([0.3, -0.3], dtype=np.float32)
        parameters = train.initial_parameters(19, 3, 0)
        parameters["b1"][:] = 0.3
        parameters["b2"][:] = 0.3
        def loss():
            output = train.predict(parameters, features)
            return train.mse((output - output[[1, 0]]) / 2, target)
        numerical = {}
        for name, index in [("w3", (0,)), ("w2", (0, 0)), ("w1", (0, 0)), ("b3", (0,))]:
            original = parameters[name][index].copy()
            parameters[name][index] = original + 0.001
            high = loss()
            parameters[name][index] = original - 0.001
            low = loss()
            parameters[name][index] = original
            numerical[(name, index)] = (high - low) / 0.002
        backend = train.NumpyBackend(parameters, 0.0002, 0)
        backend.train_batch(features, target, [1, 0])
        for (name, index), expected in numerical.items():
            self.assertAlmostEqual(float(backend.first_moment[name][index] / 0.1), expected, delta=0.0001)

    def test_warm_start_preserves_weights_and_rejects_incompatible_models(self):
        parameters = train.initial_parameters(19, 3, 0)
        path = self.folder / "initial.bin"
        header = {"target": "classic-residual-v1", "residualScale": 2000}
        metadata = {"format": "hex-value-v1", "featureSchema": train.FEATURE_SCHEMA,
                    "inputSize": train.INPUT_SIZE, "hiddenSizes": [64, 32], "outputScale": 10000,
                    "evaluation": "classic-residual-v1", "residualScale": 2000,
                    "residualSymmetry": "antisymmetric"}
        train.export_model(path, parameters, metadata)
        restored = train.read_initial_model(path, header, True)
        for name in parameters:
            np.testing.assert_array_equal(restored[name], parameters[name])
        with self.assertRaisesRegex(ValueError, "incompatible"):
            train.read_initial_model(path, {**header, "residualScale": 1000}, True)
        with self.assertRaisesRegex(ValueError, "incompatible"):
            train.read_initial_model(path, header, False)
        path.write_bytes(path.read_bytes()[:-4])
        with self.assertRaisesRegex(ValueError, "longitud"):
            train.read_initial_model(path, header, True)

    def test_perspective_projection_removes_bias_without_mixing_game_positions(self):
        rows = [
            {"kind": "sample", "gameId": f"g{index // 2}", "ply": 10,
             "perspective": index % 2, "features": [index + 1],
             "teacher": 0.2 if index % 2 == 0 else -0.2, "outcome": None}
            for index in range(4)
        ]
        path = self.dataset(rows)
        partners = train.perspective_partners(path, 4)
        self.assertEqual(partners, [1, 0, 3, 2])
        projected = train.project_predictions(np.array([0.8, 0.4, 0.7, 0.1]), [2, 3, 0, 1], partners)
        np.testing.assert_allclose(projected, [0.2, -0.2, 0.3, -0.3])
        self.dataset(rows[:-1])
        with self.assertRaisesRegex(ValueError, "falta la perspectiva"):
            train.perspective_partners(path, 3)

    def test_antisymmetric_export_uses_projected_validation_and_threat_profile(self):
        rows = [
            {"kind": "sample", "gameId": f"g{index // 2}", "ply": 10,
             "perspective": index % 2, "features": [1 + index % 2],
             "teacher": 0.2 if index % 2 == 0 else -0.2, "outcome": None}
            for index in range(8)
        ]
        path = self.dataset(rows, {"target": "classic-residual-v1", "residualScale": 2000})
        output = self.folder / "antisymmetric.bin"
        with patch("sys.argv", ["train.py", "--input", str(path), "--output", str(output),
                                "--epochs", "1", "--antisymmetric", "--teacher-weight", "1"]):
            with redirect_stdout(StringIO()):
                train.main()
        raw = output.read_bytes()
        length = int.from_bytes(raw[4:8], "little")
        metadata = json.loads(raw[8:8 + length])
        self.assertEqual(metadata["residualSymmetry"], "antisymmetric")
        self.assertEqual(metadata["searchProfile"], "pvs-threats")
        report = json.loads(Path(str(output) + ".training.json").read_text())
        self.assertLessEqual(report["loss"]["validation"], report["loss"]["rawValidation"] + 1e-7)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="hex-train-test-")
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)

    def dataset(self, rows, overrides=None):
        header = {
            "kind": "metadata",
            "format": "hexagonal-neural-dataset",
            "version": 1,
            "schema": train.FEATURE_SCHEMA,
            "inputSize": train.INPUT_SIZE,
            "teacherScale": train.OUTPUT_SCALE,
        }
        header.update(overrides or {})
        path = self.folder / "dataset.jsonl"
        path.write_text(
            "".join(json.dumps(row) + "\n" for row in [header] + rows), encoding="utf-8"
        )
        return path

    def test_generator_game_records_are_not_training_samples(self):
        path = self.dataset([
            {"kind": "sample", "gameId": "g1", "features": [3, 1], "teacher": 0.4, "outcome": None},
            {"kind": "game", "gameId": "g1", "termination": "max-plies", "actions": []},
            {"kind": "sample", "gameId": "g2", "features": [2, 4], "teacher": -0.4, "outcome": -1},
            {"kind": "game", "gameId": "g2", "termination": "engine-outcome", "actions": []},
            {"kind": "summary", "games": 2},
        ])
        _, samples = train.read_dataset(path, None)
        self.assertEqual(len(samples), 2)
        self.assertEqual(samples[0].features, (1, 3))
        self.assertIsNone(samples[0].outcome)
        np.testing.assert_allclose(train.targets(samples, 0.7), [0.4, -0.58])

    def test_invalid_or_duplicate_sparse_features_are_rejected(self):
        for features in ([2, 2], [-1], [train.INPUT_SIZE], [True], []):
            with self.subTest(features=features):
                path = self.dataset([
                    {"kind": "sample", "gameId": "g1", "features": features, "teacher": 0, "outcome": None}
                ])
                with self.assertRaises(ValueError):
                    train.read_dataset(path, None)

    def test_residual_dataset_validation_and_export_keep_the_evaluation_contract(self):
        rows = [
            {"kind": "sample", "gameId": f"game-{index // 4}", "features": [index % 2, 10],
             "teacher": 0.1 if index % 2 else -0.1, "outcome": None}
            for index in range(16)
        ]
        for scale in (None, True, -1, 5001):
            path = self.dataset(rows, {"target": "classic-residual-v1", "residualScale": scale})
            with self.assertRaisesRegex(ValueError, "residualScale"):
                train.read_dataset(path, None)
        path = self.dataset(rows, {"target": "classic-residual-v1", "residualScale": 2000})
        output = self.folder / "residual.bin"
        with patch("sys.argv", ["train.py", "--input", str(path), "--output", str(output),
                                "--epochs", "2", "--teacher-weight", "1"]), redirect_stdout(StringIO()):
            self.assertEqual(train.main(), 0)
        raw = output.read_bytes()
        length = int.from_bytes(raw[4:8], "little")
        metadata = json.loads(raw[8 : 8 + length])
        self.assertEqual(metadata["evaluation"], "classic-residual-v1")
        self.assertEqual(metadata["residualScale"], 2000)
        self.assertEqual(metadata["searchProfile"], "pvs-history")

    def test_split_has_no_game_leakage_and_is_stable_under_row_reordering(self):
        samples = [train.Sample(f"game-{i // 5}", (0,), 0.0, None) for i in range(40)]
        training, validation, details = train.split_games(samples, 17, 0.25)
        self.assertEqual(len(training), 30)
        self.assertEqual(len(validation), 10)
        self.assertTrue(set(details["trainingGames"]).isdisjoint(details["validationGames"]))
        _, _, reversed_details = train.split_games(list(reversed(samples)), 17, 0.25)
        self.assertEqual(details, reversed_details)
        with self.assertRaises(ValueError):
            train.split_games(samples[:5], 17, 0.25)

    def test_missing_outcomes_use_only_teacher_labels(self):
        samples = [train.Sample("game-1", (0,), 0.6, None), train.Sample("game-2", (1,), -0.6, None)]
        np.testing.assert_allclose(train.targets(samples, 0.0), [0.6, -0.6])

    def test_exact_feature_overlap_reports_repeated_positions_across_games(self):
        samples = [
            train.Sample("training", (0, 3, 4), 0.2, None),
            train.Sample("training", (1, 2), -0.2, None),
            train.Sample("validation", (4, 0, 3), 0.2, None),
            train.Sample("validation", (0, 3, 4), 0.2, None),
            train.Sample("validation", (4, 5), 0.2, None),
        ]
        overlap = train.feature_overlap(samples, [0, 1], [2, 3, 4])
        self.assertEqual(overlap["sharedUniqueFeatureVectors"], 1)
        self.assertEqual(overlap["validationSamplesSeenInTraining"], 2)
        self.assertEqual(overlap["validationSampleOverlapFraction"], 2 / 3)
        self.assertIsNotNone(overlap["warning"])
        self.assertIsNone(train.feature_overlap(samples, [0, 1], [4])["warning"])

    def test_binary_split_metadata_remains_small_for_many_games(self):
        samples = [train.Sample(f"long-game-identifier-{i:06d}", (0,), 0, None) for i in range(5000)]
        _, _, split = train.split_games(samples, 7, 0.2)
        summary = train.split_summary(split)
        self.assertNotIn("trainingGames", summary)
        self.assertNotIn("validationGames", summary)
        self.assertEqual(summary["trainingGameCount"], 4000)
        self.assertEqual(summary["validationGameCount"], 1000)
        self.assertLess(len(json.dumps(summary)), 1024)
        self.assertEqual(summary, train.split_summary(split))
        train.export_model(
            self.folder / "model-many-games.bin",
            train.initial_parameters(1, 1, 0),
            {"training": {"split": summary}},
        )

    def test_export_rejects_metadata_larger_than_browser_limit(self):
        with self.assertRaisesRegex(ValueError, "límite HXNN"):
            train.export_model(
                self.folder / "oversized.bin",
                train.initial_parameters(1, 1, 0),
                {"large": "x" * train.MAX_METADATA_BYTES},
            )
        self.assertFalse((self.folder / "oversized.bin").exists())

    def test_numpy_backend_learns_signal_in_held_out_positions(self):
        rng = np.random.default_rng(19)
        features = [
            tuple([i % 2] + rng.choice(np.arange(10, 40), size=4, replace=False).tolist())
            for i in range(160)
        ]
        expected = np.array([0.65 if i % 2 else -0.65 for i in range(160)], dtype=np.float32)
        parameters = train.initial_parameters(19, 5, 0)
        backend = train.NumpyBackend(parameters, 0.005, 0.00001)
        before = train.mse(train.predict(parameters, features[128:]), expected[128:])
        for _ in range(40):
            backend.train_batch(features[:128], expected[:128])
        after = train.mse(train.predict(backend.snapshot(), features[128:]), expected[128:])
        self.assertLess(after, before * 0.1)
        self.assertTrue(all(np.isfinite(value).all() for value in backend.snapshot().values()))

    def test_binary_parameter_order_and_parity_use_exported_float32(self):
        parameters = train.initial_parameters(1, 3, 0)
        path = self.folder / "model.bin"
        metadata = {"format": "hex-value-v1", "featureSchema": train.FEATURE_SCHEMA}
        train.export_model(path, parameters, metadata)
        raw = path.read_bytes()
        self.assertEqual(raw[:4], b"HXNN")
        metadata_length = int.from_bytes(raw[4:8], "little")
        self.assertEqual(json.loads(raw[8 : 8 + metadata_length]), metadata)
        offset = (8 + metadata_length + 3) // 4 * 4
        flat = np.frombuffer(raw[offset:], dtype="<f4")
        np.testing.assert_array_equal(flat, np.concatenate([
            parameters[name].reshape(-1) for name in train.PARAMETER_NAMES
        ]))
        samples = [train.Sample("game-1", (0, 3, 10), 0, None)]
        vectors = train.parity_vectors(parameters, samples, [0])
        self.assertEqual(len(vectors), 1)
        self.assertAlmostEqual(vectors[0]["expectedScore"], vectors[0]["expectedNormalized"] * 10000)


if __name__ == "__main__":
    unittest.main()
