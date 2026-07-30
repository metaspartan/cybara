---
name: huggingface-vision-trainer
description: Prepare, train, evaluate, and publish computer-vision and vision-language models with Hugging Face datasets, Transformers, PEFT, and Jobs.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/transformers/tasks","os":["darwin","linux","win32"]}}
---

# Hugging Face Vision Trainer

Use this workflow for image classification, object detection, segmentation, depth estimation, and vision-language fine-tuning.

## Workflow

1. Inspect the dataset card, license, image features, labels, splits, corrupt records, class balance, dimensions, and annotation coordinate format.
2. Visualize a small representative sample before transforming labels or augmenting images.
3. Choose a model and processor that explicitly support the task and license requirements.
4. Preserve label mappings, preprocessing settings, image normalization, and augmentation seeds in the training configuration.
5. Split by source or subject when random row splitting could leak near-duplicate images.
6. Select task-appropriate metrics such as accuracy/F1, mAP, IoU, or VQA-style scores.
7. Run a small batch through preprocessing, forward pass, loss, and metric computation before launching remote training.
8. Save the processor with the model and publish representative evaluation outputs in the model card.

For vision-language models, ensure image tokens are not truncated and verify the model's chat template. Use PEFT when it materially reduces memory without invalidating the task.

Remote GPU work follows the `huggingface-jobs` confirmation and monitoring workflow. Do not upload private images, biometric data, or sensitive annotations without explicit authorization.
