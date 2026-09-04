# AI QC

Compare source, expected structured intent, and generated output.

Scores:
- Architecture
- Camera
- Material
- Lighting
- Object consistency
- Photorealism

QC must output:
decision
scores
specific issues
severity
affected attribute/region when possible
correction instruction

If threshold fails, regeneration uses the correction instruction and preserves all valid prior constraints.
