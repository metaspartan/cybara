---
name: huggingface-llm-trainer
description: Design and run reproducible LLM fine-tuning with TRL, PEFT, Hugging Face Jobs, validated datasets, experiment tracking, and durable Hub outputs.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/trl","os":["darwin","linux","win32"]}}
---

# Hugging Face LLM Trainer

Use TRL and PEFT for supervised fine-tuning, preference optimization, reinforcement learning, and reward modeling. Use Hugging Face Jobs when remote compute is requested.

## Method selection

- SFT: instruction, conversation, or prompt-completion demonstrations
- DPO: prompt with chosen and rejected responses
- GRPO: prompts with deterministic, testable reward functions or environments
- Reward modeling: examples labeled or ranked for preference quality

Do not choose a method from the dataset name alone. Inspect the schema and sample records first with `huggingface-datasets`.

## Training plan

1. Record the base model ID and immutable revision, license, architecture, context length, tokenizer, and chat template.
2. Validate train and evaluation splits, field mapping, length distribution, duplication, contamination risk, and redaction.
3. Select full fine-tuning or PEFT from model size, hardware, memory, and deployment needs.
4. Pin dependencies in a self-contained UV script.
5. Seed data splitting and training, log the complete configuration, and define evaluation criteria before launch.
6. Enable durable output with `push_to_hub`, a target model ID, and checkpoints or mounted storage appropriate to the run.
7. Add Trackio or the requested tracker for loss, learning rate, throughput, evaluation metrics, and failure alerts.
8. Run a tiny smoke job before the paid production run.

Use current TRL configuration names verified from the installed version or official docs. Do not guess parameters from older examples.

Before launching paid compute, present the model, dataset revision, method, hardware, timeout, estimated cost boundary, output repository, and command for confirmation. After launch, report the job ID and monitoring links. Do not claim model quality from training loss alone; run task-appropriate evaluation and preserve the results with the model card.
