#!/usr/bin/env python3
"""Train the browser's sparse value network on CPU, without a Python service.

Requires NumPy; --backend torch additionally requires a CPU PyTorch installation.
The binary contains only Float32 weights, never pickle or executable model code.
Validation retains whole games. Identical feature vectors can still recur in
different games; the report quantifies this overlap because it can lower MSE.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np


FEATURE_SCHEMA = "hex-sparse-v1"
INPUT_SIZE = 5183
HIDDEN_SIZES = (64, 32)
OUTPUT_SCALE = 10000
MAX_METADATA_BYTES = 65536
PARAMETER_NAMES = ("w1", "b1", "w2", "b2", "w3", "b3")


@dataclass(frozen=True)
class Sample:
    game_id: str
    features: tuple[int, ...]
    teacher: float
    outcome: float | None


def normalized_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label}: se esperaba un número entre -1 y 1")
    number = float(value)
    if not math.isfinite(number) or not -1 <= number <= 1:
        raise ValueError(f"{label}: se esperaba un número finito entre -1 y 1")
    return number


def read_dataset(path: Path, max_samples: int | None) -> tuple[dict, list[Sample]]:
    header = None
    samples = []
    with path.open("r", encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError("cada fila debe ser un objeto JSON")
                if row.get("kind") == "metadata":
                    if header is not None or samples:
                        raise ValueError("la cabecera debe aparecer una sola vez al principio")
                    if row.get("format") != "hexagonal-neural-dataset" or row.get("version") != 1:
                        raise ValueError("formato de dataset incompatible")
                    if row.get("schema") != FEATURE_SCHEMA or row.get("inputSize") != INPUT_SIZE:
                        raise ValueError(f"se necesita {FEATURE_SCHEMA} con {INPUT_SIZE} entradas")
                    if row.get("teacherScale") != OUTPUT_SCALE:
                        raise ValueError(f"teacherScale debe ser {OUTPUT_SCALE}")
                    if row.get("target") == "classic-residual-v1":
                        scale = row.get("residualScale")
                        if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 0 < scale <= 5000:
                            raise ValueError("residualScale incompatible")
                    header = row
                    continue
                if header is None:
                    raise ValueError("falta la cabecera metadata")
                if row.get("kind") == "game":
                    if not isinstance(row.get("gameId"), str) or not row["gameId"]:
                        raise ValueError("el registro de partida necesita un gameId no vacío")
                    continue
                if row.get("kind") == "summary":
                    continue
                if row.get("kind") != "sample":
                    raise ValueError("tipo de fila desconocido")
                game_id = row.get("gameId")
                if not isinstance(game_id, str) or not game_id:
                    raise ValueError("gameId debe ser un texto no vacío")
                features = row.get("features")
                if not isinstance(features, list) or not features:
                    raise ValueError("features debe contener índices activos")
                if any(type(index) is not int or not 0 <= index < INPUT_SIZE for index in features):
                    raise ValueError("features contiene un índice inválido")
                if len(set(features)) != len(features):
                    raise ValueError("features contiene índices duplicados")
                teacher = normalized_number(row.get("teacher"), "teacher")
                outcome = row.get("outcome")
                if outcome is not None:
                    outcome = normalized_number(outcome, "outcome")
                samples.append(Sample(game_id, tuple(sorted(features)), teacher, outcome))
                if max_samples is not None and len(samples) >= max_samples:
                    break
            except (ValueError, TypeError) as error:
                raise ValueError(f"{path}:{line_number}: {error}") from error
    if not samples:
        raise ValueError("el dataset no contiene posiciones")
    return header, samples


def split_games(samples: list[Sample], seed: int, fraction: float, policy: str = "ranked") -> tuple[list[int], list[int], dict]:
    games = sorted({sample.game_id for sample in samples})
    if len(games) < 2:
        raise ValueError("se necesitan al menos dos partidas para separar entrenamiento y validación")
    # A stable cryptographic ordering is independent of Python's randomized hash.
    ordered_games = sorted(
        games, key=lambda game: hashlib.sha256(f"{seed}:{game}".encode("utf-8")).digest()
    )
    validation_count = min(len(games) - 1, max(1, round(len(games) * fraction)))
    if policy == "hash-threshold":
        validation_games = {game for game in games if int.from_bytes(hashlib.sha256(f"{seed}:{game}".encode("utf-8")).digest(), "big") / 2**256 < fraction}
        if not validation_games or len(validation_games) == len(games):
            raise ValueError("la partición estable necesita más partidas para contener entrenamiento y validación; no se reasignan partidas conocidas")
    else:
        validation_games = set(ordered_games[:validation_count])
    train = [index for index, sample in enumerate(samples) if sample.game_id not in validation_games]
    validation = [index for index, sample in enumerate(samples) if sample.game_id in validation_games]
    details = {
        "method": "sha256-game-id-threshold" if policy == "hash-threshold" else "sha256-game-id",
        "validationFractionRequested": fraction,
        "trainingGames": sorted(set(games) - validation_games),
        "validationGames": sorted(validation_games),
        "trainingSamples": len(train),
        "validationSamples": len(validation),
    }
    return train, validation, details


def targets(samples: list[Sample], teacher_weight: float) -> np.ndarray:
    return np.array(
        [
            sample.teacher
            if sample.outcome is None
            else teacher_weight * sample.teacher + (1 - teacher_weight) * sample.outcome
            for sample in samples
        ],
        dtype=np.float32,
    )


def label_statistics(samples: list[Sample], indices: list[int], target: np.ndarray) -> dict:
    values = target[indices]
    return {
        "samples": len(indices),
        "games": len({samples[index].game_id for index in indices}),
        "samplesWithOutcome": sum(samples[index].outcome is not None for index in indices),
        "clippedTargets": int(np.count_nonzero(np.abs(values) >= 0.999)),
        "meanAbsoluteTarget": float(np.mean(np.abs(values))),
    }


def split_summary(details: dict) -> dict:
    assignment = {
        "trainingGames": details["trainingGames"],
        "validationGames": details["validationGames"],
    }
    encoded = json.dumps(assignment, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {
        "method": details["method"],
        "validationFractionRequested": details["validationFractionRequested"],
        "trainingGameCount": len(details["trainingGames"]),
        "validationGameCount": len(details["validationGames"]),
        "trainingSamples": details["trainingSamples"],
        "validationSamples": details["validationSamples"],
        "gameAssignmentSha256": hashlib.sha256(encoded).hexdigest(),
    }


def feature_overlap(samples: list[Sample], training: list[int], validation: list[int]) -> dict:
    def fingerprint(index: int) -> bytes:
        encoded = np.asarray(sorted(samples[index].features), dtype="<u4").tobytes()
        return hashlib.sha256(encoded).digest()

    training_fingerprints = {fingerprint(index) for index in training}
    validation_fingerprints = [fingerprint(index) for index in validation]
    validation_unique = set(validation_fingerprints)
    shared = training_fingerprints & validation_unique
    seen_samples = sum(value in training_fingerprints for value in validation_fingerprints)
    return {
        "method": "sha256-uint32le-sorted-active-feature-indices",
        "trainingUniqueFeatureVectors": len(training_fingerprints),
        "validationUniqueFeatureVectors": len(validation_unique),
        "sharedUniqueFeatureVectors": len(shared),
        "validationSamplesSeenInTraining": seen_samples,
        "validationSampleOverlapFraction": seen_samples / len(validation),
        "warning": (
            "Hay vectores de características idénticos en partidas distintas de ambos conjuntos; "
            "la MSE de validación puede ser optimista. La fuerza se debe medir en partidas nuevas."
            if shared else None
        ),
    }


def initial_parameters(seed: int, active_count: float, target_mean: float) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    return {
        "w1": rng.normal(0, math.sqrt(2 / active_count), (INPUT_SIZE, 64)).astype(np.float32),
        "b1": np.zeros(64, dtype=np.float32),
        "w2": rng.normal(0, math.sqrt(2 / 64), (64, 32)).astype(np.float32),
        "b2": np.zeros(32, dtype=np.float32),
        "w3": rng.normal(0, 0.05 / math.sqrt(32), 32).astype(np.float32),
        "b3": np.array([np.arctanh(np.clip(target_mean, -0.95, 0.95))], dtype=np.float32),
    }


def sparse_first_layer(parameters: dict[str, np.ndarray], features: list[tuple[int, ...]]) -> np.ndarray:
    return np.stack(
        [parameters["w1"][list(indices)].sum(axis=0) + parameters["b1"] for indices in features]
    )


def predict(parameters: dict[str, np.ndarray], features: list[tuple[int, ...]]) -> np.ndarray:
    first = np.maximum(sparse_first_layer(parameters, features), 0)
    second = np.maximum(first @ parameters["w2"] + parameters["b2"], 0)
    return np.tanh(second @ parameters["w3"] + parameters["b3"][0])


class NumpyBackend:
    def __init__(self, parameters: dict[str, np.ndarray], learning_rate: float, weight_decay: float):
        self.parameters = parameters
        self.first_moment = {name: np.zeros_like(value) for name, value in parameters.items()}
        self.second_moment = {name: np.zeros_like(value) for name, value in parameters.items()}
        self.learning_rate = learning_rate
        self.weight_decay = weight_decay
        self.step = 0

    def train_batch(self, features: list[tuple[int, ...]], target: np.ndarray, partners: list[int] | None = None) -> None:
        p = self.parameters
        first_pre = sparse_first_layer(p, features)
        first = np.maximum(first_pre, 0)
        second_pre = first @ p["w2"] + p["b2"]
        second = np.maximum(second_pre, 0)
        output = np.tanh(second @ p["w3"] + p["b3"][0])
        if partners is None:
            output_delta = (2 / len(features)) * (output - target) * (1 - output * output)
        else:
            error = (output - output[partners]) / 2 - target
            output_delta = (error - error[partners]) / len(features) * (1 - output * output)
        second_delta = output_delta[:, None] * p["w3"][None, :] * (second_pre > 0)
        first_delta = (second_delta @ p["w2"].T) * (first_pre > 0)
        first_gradient = np.zeros_like(p["w1"])
        indices = np.concatenate([np.asarray(active, dtype=np.int32) for active in features])
        owners = np.repeat(np.arange(len(features)), [len(active) for active in features])
        np.add.at(first_gradient, indices, first_delta[owners])
        gradients = {
            "w1": first_gradient,
            "b1": first_delta.sum(axis=0),
            "w2": first.T @ second_delta,
            "b2": second_delta.sum(axis=0),
            "w3": second.T @ output_delta,
            "b3": np.array([output_delta.sum()], dtype=np.float32),
        }
        gradient_norm = math.sqrt(sum(float(np.sum(gradient * gradient)) for gradient in gradients.values()))
        gradient_scale = min(1.0, 5.0 / max(gradient_norm, 1e-12))
        self.step += 1
        for name, parameter in p.items():
            gradient = gradients[name] * gradient_scale
            first_moment = self.first_moment[name]
            second_moment = self.second_moment[name]
            first_moment *= 0.9
            first_moment += 0.1 * gradient
            second_moment *= 0.999
            second_moment += 0.001 * gradient * gradient
            corrected_first = first_moment / (1 - 0.9**self.step)
            corrected_second = second_moment / (1 - 0.999**self.step)
            if name.startswith("w"):
                parameter *= 1 - self.learning_rate * self.weight_decay
            parameter -= self.learning_rate * corrected_first / (np.sqrt(corrected_second) + 1e-8)

    def snapshot(self) -> dict[str, np.ndarray]:
        return {name: value.copy() for name, value in self.parameters.items()}


class TorchBackend:
    def __init__(self, parameters: dict[str, np.ndarray], learning_rate: float, weight_decay: float):
        try:
            import torch
        except ImportError as error:
            raise ValueError(
                "PyTorch no está instalado; usa --backend numpy o instala torch en un entorno virtual"
            ) from error
        torch.set_num_threads(1)
        torch.use_deterministic_algorithms(True)
        self.torch = torch
        self.parameters = {
            name: torch.nn.Parameter(torch.from_numpy(value.copy())) for name, value in parameters.items()
        }
        self.optimizer = torch.optim.AdamW(
            [
                {"params": [value for name, value in self.parameters.items() if name.startswith("w")], "weight_decay": weight_decay},
                {"params": [value for name, value in self.parameters.items() if name.startswith("b")], "weight_decay": 0},
            ],
            lr=learning_rate,
        )

    def train_batch(self, features: list[tuple[int, ...]], target: np.ndarray, partners: list[int] | None = None) -> None:
        torch = self.torch
        p = self.parameters
        indices = torch.tensor([index for active in features for index in active], dtype=torch.long)
        offsets = torch.tensor(np.cumsum([0] + [len(active) for active in features]), dtype=torch.long)
        first = torch.nn.functional.embedding_bag(
            indices, p["w1"], offsets, mode="sum", include_last_offset=True
        )
        first = torch.relu(first + p["b1"])
        second = torch.relu(first @ p["w2"] + p["b2"])
        output = torch.tanh(second @ p["w3"] + p["b3"][0])
        projected = output if partners is None else (output - output[partners]) / 2
        loss = torch.mean((projected - torch.from_numpy(target)) ** 2)
        self.optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(list(p.values()), 5.0)
        self.optimizer.step()

    def snapshot(self) -> dict[str, np.ndarray]:
        return {name: value.detach().cpu().numpy().copy() for name, value in self.parameters.items()}


def mse(actual: np.ndarray, expected: np.ndarray) -> float:
    return float(np.mean((actual.astype(np.float64) - expected) ** 2))


def evaluate(parameters: dict[str, np.ndarray], samples: list[Sample], indices: list[int], batch_size: int) -> np.ndarray:
    return np.concatenate(
        [
            predict(parameters, [samples[index].features for index in indices[start : start + batch_size]])
            for start in range(0, len(indices), batch_size)
        ]
    )


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_model(path: Path, parameters: dict[str, np.ndarray], metadata: dict) -> int:
    encoded = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_METADATA_BYTES:
        raise ValueError(f"la metadata del modelo supera el límite HXNN de {MAX_METADATA_BYTES} bytes")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as destination:
        destination.write(b"HXNN")
        destination.write(struct.pack("<I", len(encoded)))
        destination.write(encoded)
        destination.write(b"\0" * (-(8 + len(encoded)) % 4))
        for name in PARAMETER_NAMES:
            destination.write(parameters[name].astype("<f4", copy=False).tobytes(order="C"))
    return path.stat().st_size


def read_initial_model(path: Path, header: dict, antisymmetric: bool) -> dict[str, np.ndarray]:
    raw = path.read_bytes()
    if len(raw) < 8 or raw[:4] != b"HXNN":
        raise ValueError("modelo inicial HXNN inválido")
    length = struct.unpack("<I", raw[4:8])[0]
    if not 0 < length <= MAX_METADATA_BYTES or 8 + length > len(raw):
        raise ValueError("metadata del modelo inicial inválida")
    metadata = json.loads(raw[8:8 + length])
    if (metadata.get("format") != "hex-value-v1" or metadata.get("featureSchema") != FEATURE_SCHEMA
            or metadata.get("inputSize") != INPUT_SIZE or metadata.get("hiddenSizes") != list(HIDDEN_SIZES)
            or metadata.get("outputScale") != OUTPUT_SCALE
            or metadata.get("evaluation", "standalone-v1") != header.get("target", "standalone-v1")
            or metadata.get("residualScale") != header.get("residualScale")
            or (metadata.get("residualSymmetry") == "antisymmetric") != antisymmetric):
        raise ValueError("contrato del modelo inicial incompatible con el dataset")
    offset = (8 + length + 3) // 4 * 4
    shapes = {"w1": (INPUT_SIZE, 64), "b1": (64,), "w2": (64, 32), "b2": (32,), "w3": (32,), "b3": (1,)}
    count = sum(math.prod(shape) for shape in shapes.values())
    if len(raw) != offset + count * 4 or any(raw[8 + length:offset]):
        raise ValueError("longitud del modelo inicial inválida")
    weights = np.frombuffer(raw, dtype="<f4", offset=offset)
    if not np.isfinite(weights).all():
        raise ValueError("pesos del modelo inicial no finitos")
    parameters = {}
    start = 0
    for name, shape in shapes.items():
        end = start + math.prod(shape)
        parameters[name] = weights[start:end].reshape(shape).copy()
        start = end
    return parameters


def parity_vectors(parameters: dict[str, np.ndarray], samples: list[Sample], indices: list[int]) -> list[dict]:
    # Mirror JavaScript's Number accumulation, using the exact exported Float32 weights.
    p = {name: value.astype(np.float32).astype(np.float64) for name, value in parameters.items()}
    vectors = []
    for index in indices[:16]:
        features = samples[index].features
        normalized = float(predict(p, [features])[0])
        vectors.append({
            "features": list(features),
            "expectedNormalized": normalized,
            "expectedScore": normalized * OUTPUT_SCALE,
        })
    return vectors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Entrena y exporta el evaluador neuronal local HXNN.")
    parser.add_argument("--input", type=Path, default=Path(".ai-lab/dataset.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("src/ai-models/hex-value.bin"))
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--seed", type=int, default=20261018)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--backend", choices=("numpy", "torch"), default="numpy")
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--weight-decay", type=float, default=0.00001)
    parser.add_argument("--teacher-weight", type=float, default=0.7)
    parser.add_argument("--max-samples", type=int)
    parser.add_argument("--initialize-model", type=Path, help="Continúa los pesos; reinicia AdamW")
    parser.add_argument("--split-seed", type=int, help="Semilla de partición independiente de los pesos")
    parser.add_argument("--split-policy", choices=("ranked", "hash-threshold"), default="ranked")
    parser.add_argument("--antisymmetric", action="store_true", help="Proyecta la corrección residual sobre perspectivas opuestas emparejadas")
    args = parser.parse_args()
    if args.antisymmetric and args.batch_size % 2:
        parser.error("--antisymmetric requiere --batch-size par")
    for name in ("epochs", "batch_size", "patience"):
        if getattr(args, name) < 1:
            parser.error(f"--{name.replace('_', '-')} debe ser mayor que cero")
    if args.max_samples is not None and args.max_samples < 2:
        parser.error("--max-samples debe ser al menos 2")
    if not 0 < args.validation_fraction < 1:
        parser.error("--validation-fraction debe estar entre 0 y 1")
    if not math.isfinite(args.learning_rate) or args.learning_rate <= 0:
        parser.error("--learning-rate debe ser finito y positivo")
    if not math.isfinite(args.weight_decay) or args.weight_decay < 0:
        parser.error("--weight-decay debe ser finito y no negativo")
    if not 0 <= args.teacher_weight <= 1:
        parser.error("--teacher-weight debe estar entre 0 y 1")
    return args


def perspective_partners(path: Path, count: int) -> list[int]:
    with path.open("r", encoding="utf-8-sig") as source:
        rows = [row for line in source if line.strip() if (row := json.loads(line)).get("kind") == "sample"][:count]
    indices = {}
    for index, row in enumerate(rows):
        perspective, ply = row.get("perspective"), row.get("ply")
        if type(perspective) is not int or perspective not in (0, 1) or type(ply) is not int:
            raise ValueError("--antisymmetric requiere perspectiva y ply en cada muestra")
        key = (row["gameId"], ply, perspective)
        if key in indices:
            raise ValueError("muestra duplicada para una perspectiva y posición")
        indices[key] = index
    partners = []
    for row in rows:
        partner = indices.get((row["gameId"], row["ply"], 1 - row["perspective"]))
        if partner is None:
            raise ValueError("falta la perspectiva opuesta de una muestra")
        partners.append(partner)
    return partners


def project_predictions(predictions: np.ndarray, indices: list[int], partners: list[int] | None) -> np.ndarray:
    if partners is None:
        return predictions
    offsets = {index: offset for offset, index in enumerate(indices)}
    opposite = [offsets[partners[index]] for index in indices]
    return (predictions - predictions[opposite]) / 2


def main() -> int:
    args = parse_args()
    header, samples = read_dataset(args.input, args.max_samples)
    if header.get("target") == "classic-residual-v1" and args.teacher_weight != 1 and any(sample.outcome is not None for sample in samples):
        raise ValueError("las etiquetas residuales con resultados requieren --teacher-weight 1; el resultado ya se combina antes de calcular el residuo")
    if args.antisymmetric and header.get("target") != "classic-residual-v1":
        raise ValueError("--antisymmetric requiere un dataset residual")
    partners = perspective_partners(args.input, len(samples)) if args.antisymmetric else None
    split_seed = args.seed if args.split_seed is None else args.split_seed
    training, validation, split = split_games(samples, split_seed, args.validation_fraction, args.split_policy)
    overlap = feature_overlap(samples, training, validation)
    if overlap["warning"]:
        print(
            f"Aviso: {overlap['validationSamplesSeenInTraining']}/{len(validation)} muestras de "
            f"validación repiten características de entrenamiento. {overlap['warning']}",
            file=sys.stderr,
            flush=True,
        )
    target = targets(samples, args.teacher_weight)
    if partners is not None and not np.allclose(target + target[partners], 0, atol=1e-6):
        raise ValueError("las etiquetas emparejadas deben ser opuestas")
    parameters = initial_parameters(
        args.seed,
        float(np.mean([len(samples[index].features) for index in training])),
        float(target[training].mean()),
    )
    if args.initialize_model:
        parameters = read_initial_model(args.initialize_model, header, args.antisymmetric)
    backend_type = NumpyBackend if args.backend == "numpy" else TorchBackend
    backend = backend_type(parameters, args.learning_rate, args.weight_decay)
    best_parameters = backend.snapshot()
    best_loss = mse(project_predictions(evaluate(best_parameters, samples, validation, args.batch_size), validation, partners), target[validation])
    initial_loss = best_loss
    best_epoch = 0
    stale_epochs = 0
    history = []
    rng = np.random.default_rng(args.seed)
    print(f"Entrenamiento: {len(training)} posiciones; validación: {len(validation)}; backend: {args.backend}", flush=True)
    for epoch in range(1, args.epochs + 1):
        if partners is None:
            shuffled = rng.permutation(training)
        else:
            anchors = rng.permutation([index for index in training if index < partners[index]])
            shuffled = np.array([index for anchor in anchors for index in (anchor, partners[anchor])])
        for start in range(0, len(shuffled), args.batch_size):
            batch = shuffled[start : start + args.batch_size]
            local_partners = None if partners is None else [index ^ 1 for index in range(len(batch))]
            backend.train_batch([samples[index].features for index in batch], target[batch], local_partners)
        parameters = backend.snapshot()
        if any(not np.isfinite(value).all() for value in parameters.values()):
            raise ValueError("el entrenamiento produjo pesos no finitos; reduce --learning-rate")
        training_loss = mse(project_predictions(evaluate(parameters, samples, training, args.batch_size), training, partners), target[training])
        validation_loss = mse(project_predictions(evaluate(parameters, samples, validation, args.batch_size), validation, partners), target[validation])
        if not math.isfinite(training_loss) or not math.isfinite(validation_loss):
            raise ValueError("el entrenamiento produjo una pérdida no finita")
        history.append({"epoch": epoch, "trainingMse": training_loss, "validationMse": validation_loss})
        print(f"Época {epoch:3d}: MSE entrenamiento {training_loss:.6f}; validación {validation_loss:.6f}", flush=True)
        if validation_loss < best_loss - 1e-7:
            best_loss = validation_loss
            best_epoch = epoch
            best_parameters = parameters
            stale_epochs = 0
        else:
            stale_epochs += 1
        if stale_epochs >= args.patience:
            break
    validation_target = target[validation]
    validation_teacher = np.array([samples[index].teacher for index in validation], dtype=np.float32)
    train_mean = float(target[training].mean())
    raw_validation_predictions = evaluate(best_parameters, samples, validation, args.batch_size)
    validation_predictions = project_predictions(raw_validation_predictions, validation, partners)
    report = {
        "format": "hex-value-training-v1",
        "featureSchema": FEATURE_SCHEMA,
        "inputSize": INPUT_SIZE,
        "backend": args.backend,
        "numpyVersion": np.__version__,
        "seed": args.seed,
        "splitSeed": split_seed,
        "epochsRequested": args.epochs,
        "epochs": len(history),
        "bestEpoch": best_epoch,
        "earlyStopped": len(history) < args.epochs,
        "samples": len(samples),
        "maxSamples": args.max_samples,
        "datasetSha256": file_digest(args.input),
        "initialModel": {"path": str(args.initialize_model), "sha256": file_digest(args.initialize_model)} if args.initialize_model else None,
        "samplesWithOutcome": sum(sample.outcome is not None for sample in samples),
        "teacherWeight": args.teacher_weight,
        "batchSize": args.batch_size,
        "learningRate": args.learning_rate,
        "weightDecay": args.weight_decay,
        "optimizer": "AdamW",
        "residualSymmetry": "antisymmetric" if args.antisymmetric else None,
        "trainingObjective": "projected-paired-perspectives-mse" if args.antisymmetric else "raw-mse",
        "split": split,
        "featureOverlap": overlap,
        "labelStatistics": {
            "training": label_statistics(samples, training, target),
            "validation": label_statistics(samples, validation, target),
        },
        "loss": {
            "name": "normalized-target-mse",
            "initialValidation": initial_loss,
            "validation": mse(validation_predictions, validation_target),
            "rawValidation": mse(raw_validation_predictions, validation_target),
            "training": mse(project_predictions(evaluate(best_parameters, samples, training, args.batch_size), training, partners), target[training]),
            "zeroBaselineValidation": mse(np.zeros_like(validation_target), validation_target),
            "trainingMeanBaselineValidation": mse(np.full_like(validation_target, train_mean), validation_target),
            "teacherBaselineValidation": mse(validation_teacher, validation_target),
            "validationAgainstTeacher": mse(validation_predictions, validation_teacher),
        },
        "datasetSettings": header.get("settings"),
        "target": header.get("target", "standalone-v1"),
        "evaluationVersion": header.get("evaluationVersion"),
        "residualScale": header.get("residualScale"),
        "history": history,
    }
    metadata = {
        "format": "hex-value-v1",
        "featureSchema": FEATURE_SCHEMA,
        "inputSize": INPUT_SIZE,
        "hiddenSizes": list(HIDDEN_SIZES),
        "outputScale": OUTPUT_SCALE,
        "training": {
            **{key: value for key, value in report.items() if key not in (
                "history", "format", "featureSchema", "inputSize", "split", "datasetSettings"
            )},
            "split": split_summary(split),
        },
    }
    if header.get("target") == "classic-residual-v1":
        scale = header.get("residualScale")
        if not isinstance(scale, (int, float)) or not 0 < scale <= 5000:
            raise ValueError("residualScale incompatible")
        metadata["evaluation"] = "classic-residual-v1"
        metadata["residualScale"] = scale
        metadata["searchProfile"] = "pvs-history"
        if args.antisymmetric:
            metadata["residualSymmetry"] = "antisymmetric"
            metadata["searchProfile"] = "pvs-threats"
    binary_size = export_model(args.output, best_parameters, metadata)
    report["binaryBytes"] = binary_size
    report_path = Path(str(args.output) + ".training.json")
    parity_path = Path(str(args.output) + ".parity.json")
    write_json(report_path, report)
    write_json(parity_path, {
        "format": "hex-value-parity-v1",
        "featureSchema": FEATURE_SCHEMA,
        "inputSize": INPUT_SIZE,
        "vectors": parity_vectors(best_parameters, samples, validation),
    })
    print(f"Modelo: {args.output} ({binary_size:,} bytes); mejor época: {best_epoch}; MSE: {best_loss:.6f}", flush=True)
    print(f"Informe: {report_path}; paridad: {parity_path}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
