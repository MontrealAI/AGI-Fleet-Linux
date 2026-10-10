---
name: agi-document-work
description: Create and revise Word documents, spreadsheets, slide decks, PDFs and structured data files in the AGI work sandbox.
---

Read /job-input/job.json and the declared public inputs under /job-input/inputs. Save final files with the exact declared names under /workspace/deliverables. The service collects only those names. Use the installed Python docx, openpyxl, pptx, reportlab, pandas and matplotlib libraries; LibreOffice Writer, Calc and Impress are also available. Do not assume Internet package installation is available.

For Word/PDF: render with `agi-inspect /workspace/deliverables/report.docx --out /workspace/inspection` (use `agi-inspect --help` for syntax), then use read on the resulting page PNGs. Fix overflow, clipped text, poor spacing, missing glyphs, wrong page breaks and inconsistent hierarchy. Inspect all material pages. For long files the renderer caps previews; use targeted page rendering when necessary or mark coverage incomplete.

For spreadsheets: use formulas when requested, recompute independently, and check units, totals, edge cases and date interpretation. Use LibreOffice to recalculate and inspect the actual saved workbook; openpyxl alone does not calculate formulas. Verify both the formulas and the values seen when reopening the delivered file. For slides: render and inspect every slide, keep labels legible and include source notes when relevant. For code: run meaningful tests and inspect its user interface where relevant; include reproducible instructions and dependencies in the declared project ZIP. No network is available to arbitrary shell code.

Never fabricate images, source facts, citations or validation evidence. Agent image jobs have a dedicated generation route; a computer-work session can draw graphics with code but cannot assume an image-generation tool exists. Keep each file and the combined output inside the job's explicit size limits. Larger projects require a separately agreed specification, not silent truncation.
