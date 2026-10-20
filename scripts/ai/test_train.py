"""Small CPU regressions: python -B scripts/ai/test_train.py."""

import json
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

import numpy as np

import train


class TrainingTests(unittest.TestCase):
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
