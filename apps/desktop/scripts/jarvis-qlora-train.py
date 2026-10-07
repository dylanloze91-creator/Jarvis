#!/usr/bin/env python3
"""
Entraînement QLoRA local pour Jarvis (4-bit, petit lot, RTX 2060 6 Go).
Entrée : fichier JSONL (messages OpenAI). Sortie : adaptateur LoRA + Modelfile Ollama.
Aucune donnée ne quitte la machine.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def format_example(row: dict) -> str:
    parts: list[str] = []
    for msg in row.get("messages", []):
        role = msg.get("role", "user")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        if role == "user":
            parts.append(f"<|im_start|>user\n{content}")
        else:
            parts.append(f"<|im_start|>assistant\n{content}")
    parts.append("<|im_start|>assistant\n")
    return "\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jsonl", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--hf-model", required=True)
    parser.add_argument("--ollama-base", required=True)
    parser.add_argument("--max-steps", type=int, default=40)
    args = parser.parse_args()

    jsonl = Path(args.jsonl)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    rows = load_rows(jsonl)
    if len(rows) < 2:
        print("Trop peu d'exemples", file=sys.stderr)
        return 2

    texts = [format_example(r) for r in rows]

    try:
        import torch
        from datasets import Dataset
        from peft import LoraConfig, get_peft_model
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments
        from trl import SFTTrainer
    except ImportError as exc:
        print(f"MISSING_DEPS: {exc}", file=sys.stderr)
        return 3

    use_cuda = torch.cuda.is_available()
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16 if use_cuda else torch.float32,
        bnb_4bit_use_double_quant=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.hf_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.hf_model,
        quantization_config=bnb if use_cuda else None,
        device_map="auto" if use_cuda else None,
        trust_remote_code=True,
    )
    lora = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = get_peft_model(model, lora)

    ds = Dataset.from_dict({"text": texts})
    training_args = TrainingArguments(
        output_dir=str(out / "checkpoints"),
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        max_steps=min(args.max_steps, max(8, len(texts) * 2)),
        learning_rate=2e-4,
        logging_steps=5,
        save_steps=1000,
        fp16=use_cuda,
        report_to=[],
    )
    trainer = SFTTrainer(
        model=model,
        train_dataset=ds,
        args=training_args,
        processing_class=tokenizer,
    )
    trainer.train()

    adapter_path = out / "adapter"
    adapter_path.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)

    modelfile = out / "Modelfile"
    modelfile.write_text(
        f"FROM {args.ollama_base}\nADAPTER ./adapter\n",
        encoding="utf-8",
    )
    print("OK", adapter_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
