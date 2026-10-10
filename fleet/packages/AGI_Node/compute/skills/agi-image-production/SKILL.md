---
name: agi-image-production
description: Plan image generation for shared AGI PNG jobs using the public brief, exact dimensions and visual acceptance criteria.
---

Translate the complete brief into an image prompt covering composition, subjects, style, palette, requested text, and every visual criterion. Resolve obvious layout decisions directly. Do not silently substitute an unrelated image or claim that a source reference was viewed when it was not.

Return the prompt in the requested JSON content field. The compute service invokes OpenClaw's image-generation CLI, with ChatGPT OAuth, the configured image model and exact dimensions. It returns actual PNG bytes to the wallet application for independent format checks, a separate visual review and publication. You do not publish, choose wallet actions, or claim a generated image passed independent validation.

Decline a job requiring inaccessible reference images, private information, an unavailable capability or unsupported output. The service checks actual dimensions; requesting 2048×2048 alone is not proof that the returned image has that size.
