# LLM Judge Calibration

This document tracks answer-level calibration examples for the open-ended LLM judge. The goal is to preserve the intended standards while allowing medium and default grading to give full credit for clear, conceptually correct answers that omit minor wording or precision.

## Example 1: Prediction intervals and confidence intervals

**Question:** Explain why a prediction interval is usually wider than a confidence interval.

**Answer under review:** “prediction interval accounts for the individual variation of a single guess, which is usually wider than the confidence interval, AND it also accounts for the confidence interval.”

**Observed score:** 0.9/1

**Calibration decision:** Keep 0.9/1 as a reasonable hard-grade score. Give 1/1 at medium/default grading: the answer identifies individual variation and says the prediction interval includes the confidence interval's uncertainty. It could be more precise by stating that a confidence interval describes uncertainty in the estimated mean, but this is a clarification rather than a substantive gap.

**Preferred judge feedback:** Correctly explains that a prediction interval includes individual variation as well as the uncertainty represented by a confidence interval. The answer could be more precise by saying that the confidence interval describes uncertainty in the estimated mean, but the main distinction is clear.

**Rubric implication:** At medium/default strictness, do not deduct for omitting the explicit phrase “uncertainty in the estimated mean” when the answer clearly states that a prediction interval includes individual variation and the confidence interval's uncertainty.

## Remaining examples

## Example 2: Extrapolation beyond the training range

**Question:** A model was trained on jobs with 300–600 square feet. You ask it to predict for a 1,200 square foot job, and it outputs a number. Why is this prediction dangerous?

**Answer under review:** “this prediction is dangerous because it assumes the new data follows the assumed data distribution shape of 300-600 square feet when it does not. This is extrapolation, and we cannot be as confident in the model's predictions.”

**Observed score:** 0.6/1

**Calibration decision:** Give about 0.9/1 at medium/default grading. The answer identifies extrapolation, that the point is outside the training range, and lower confidence. “Assumes the new data follows the assumed data distribution shape” is indirect wording for lack of data support and reliance on the model's assumed shape, but the central risk is captured. A hard grade may reasonably score it around 0.7–0.8 for not stating those details directly.

**Preferred judge feedback:** Correctly identifies this as extrapolation and explains that the model is less trustworthy outside the range it was trained on. It could be more explicit that no training data supports the prediction at 1,200 sq ft and that the prediction depends on the assumed model shape.

**Rubric implication:** Medium/default grading should give strong credit for identifying extrapolation and reduced confidence, even if “no data support” and “assumed model shape” are not stated in the reference answer's exact terms. Reserve larger deductions for answers that miss extrapolation or fail to explain why it reduces reliability.

## Example 3: Training error and new data

**Question:** Why is training error a poor measure of how well a model predicts new jobs? What should you use instead?

**Answer under review:** “Training error is a poor measure of how well a model predicts new jobs because it is trained to make those specific residuals as small as possible. You should use Cross Validation error, and held out error on new unseen data as well. You can do this by splitting up your data with 5 fold CV, having validation sets, etc.”

**Observed score:** 0.8/1

**Calibration decision:** Give 1/1 at medium/default grading. The answer explains that training error reflects fitting to the same observations and recommends both cross-validation and held-out testing. A hard grade could give 0.8–0.9 if it expects the answer to explicitly say that cross-validation reduces the luck of a single split.

**Preferred judge feedback:** Correctly explains why training error is optimistic and recommends cross-validation and held-out testing to estimate performance on unseen data. Using five folds also addresses dependence on any one split.

**Rubric implication:** Do not require an explicit explanation that cross-validation reduces split luck when the answer recommends k-fold cross-validation. Treat this as an elaboration, not a missing core concept, at medium/default strictness.

## Example 4: Underfitting, overfitting, and data quantity

**Question:** Distinguish underfitting and overfitting, and explain how the amount of data affects how much complexity you can safely use.

**Answer under review:** The answer clearly defines underfitting as a model too simple to capture the pattern and overfitting as a model that memorizes noise, with examples. It does not discuss how data quantity affects safe complexity.

**Observed score:** 0.5/1

**Calibration decision:** Keep 0.5/1 as a reasonable hard-grade score. Give about 0.7/1 at medium/default grading: the definitions are clear and well illustrated, but a substantial part of the prompt (the effect of data quantity) is unanswered.

**Preferred judge feedback:** Your definitions and examples of underfitting and overfitting are clear. The answer also needs to explain that more data can support safely using more model complexity, while complex models are more likely to overfit when data is limited.

**Rubric implication:** Award meaningful credit for a correct, complete treatment of one part of a multi-part prompt, but deduct for a substantial omitted part. Medium/default grading should communicate the missing part specifically rather than treating the entire response as weak.

## Remaining examples

## Example 5: Regression complexity dials

**Question:** Name the three complexity dials for regression mentioned in the note and explain why turning them up can hurt prediction on new data.

**Answer under review:** The answer names adding polynomial terms, adding coefficients/predictors, and adding interactions. It explains that each adds flexibility and can lead to overfitting or memorizing noise.

**Observed score:** 0.8/1

**Calibration decision:** Give 1/1 at medium/default grading. The response answers both requested parts. Choosing complexity where held-out error is lowest is useful additional advice, but it was not asked for and should not be required for full credit. A hard grade might give around 0.9/1 if it expects a more explicit link between better training fit and worse held-out prediction.

**Preferred judge feedback:** Correctly identifies more predictors, polynomial terms, and interactions as ways to increase flexibility, and explains that this can overfit noise and hurt predictions on new data.

**Rubric implication:** Do not deduct for omitting unasked recommendations such as selecting complexity by held-out error. Evaluate the requested concepts rather than expanding the required answer beyond the prompt.

## Remaining examples

## Example 6: Interpreting a parking coefficient with square footage

**Question:** A regression model predicts rent using parking status alone and finds that apartments with parking have higher rent. Explain why adding square footage could change the parking coefficient, and state what interpretation is appropriate after square footage is included.

**Answer under review:** “adding square footage could change the parking coefficient because these coefficients likely account for eachother and are related. They are not completely independent. After square footage is included, it is appropriate to interpret these numbers as related variables, for the collected data.”

**Observed score:** 1/1

**Calibration decision:** Give about 0.6/1 at medium/default grading. The answer gets partial credit for recognizing that parking and square footage are related, but it does not explain that apartments with parking may be larger, that omitting square footage can shift the parking coefficient, or that the adjusted parking coefficient compares apartments at the same square footage. It also does not distinguish an observational association from a causal effect. A hard grade may score it lower.

**Preferred judge feedback:** Parking and square footage can be related, so leaving square footage out may cause the parking coefficient to partly reflect apartment size. Once square footage is included, the parking coefficient describes the predicted rent difference for apartments with the same square footage. This observational coefficient alone does not establish a causal effect.

**Rubric implication:** Give limited credit for a vague recognition that predictors are related, but require a meaningful explanation of omitted-variable influence and the conditional interpretation when the prompt asks for both. Feedback should name these gaps directly.

## Remaining examples

## Example 7: Interpreting R²

**Question:** A regression model has R² = 0.25. Explain what this value says about the model's fit and identify two conclusions it does not justify.

**Answer under review:** “model captures 25% of the variance in the data. Model does not capture 75% of the variance in data. Does not tell you if model is good or bad. just tells you the model fit accounts for 25% of the variance in collected data. Does not justify a good model, or a bad model. Does not justify that the variance it captures is important.”

**Observed score:** 0.5/1

**Calibration decision:** Give 1/1 at medium/default grading. The answer correctly interprets explained and unexplained variation, and offers two valid limitations: R² alone does not establish whether the model is good or bad, or whether the explained variation is important. The prompt does not require the particular examples of causation and new-data prediction. A hard grade might ask for more specificity, but should not require only the judge's preferred examples.

**Preferred judge feedback:** Correctly explains that the model accounts for 25% of the response variation and identifies valid limits on what R² tells us. R² by itself does not establish model usefulness or the importance of the explained variation.

**Rubric implication:** When a prompt asks for a number of valid conclusions without prescribing which ones, accept other correct conclusions rather than requiring a fixed list from the reference answer. Do not penalize equivalent or defensible interpretations just because they differ from expected examples.

## Remaining examples

## Example 8: Page tables and process isolation

**Question:** Explain how page tables allow two different processes to use the same virtual address, such as 0x100, at the same time without interfering with each other.

**Answer under review:** “page tables allow 2 different processes to use the same virtual address such as 0x100 because it maps that virtual address to two different physical locations. It takes the virtual address that the process wants, takes it to the Page Table, and finds its corresponding location in real physical memory.”

**Observed score:** 0.5/1

**Calibration decision:** Give about 0.8/1 at medium/default grading. The answer states that the same virtual address maps to different physical locations and describes address translation. It does not clearly state that each process has its own page table and that the active process determines which mapping is used. Hard grading may deduct more for omitting this isolation mechanism.

**Preferred judge feedback:** Correctly explains that the same virtual address can map to different physical locations. To explain why the processes stay isolated, state that each process has its own page table and the hardware uses the current process's table for translation.

**Rubric implication:** Give substantial credit when an answer accurately describes distinct physical mappings and page-table translation, even if it omits the process-specific table mechanism. Deduct for failing to explain isolation, with the deduction scaled by grading strictness.

## Remaining examples

## Example 9: TLB hits and misses

**Question:** What is the TLB, and what happens on a TLB hit versus a TLB miss?

**Answer under review:** “Translation look aside buffer. TLB hit is when it has fetched data from that memory region recently, and has stored that adress and region, so it can quickly fetch it again. For TLB miss, it does not have that address, and needs to walk the page tables to find it again, which is slower.”

**Observed score:** 0.5/1

**Calibration decision:** Give about 0.75/1 at medium/default grading. The answer identifies the TLB and correctly says a miss requires a slower page-table walk. It partly conveys that a hit uses a stored recent address, but describes that hit as fetching data, rather than using a cached virtual-to-physical translation without a page-table walk. Hard grading may score this lower because that distinction is central to defining the TLB.

**Preferred judge feedback:** Correctly identifies the TLB and explains that a miss requires a slower page-table walk. The TLB caches address translations, not data values; on a hit, the CPU gets the physical address without walking the page table.

**Rubric implication:** Preserve credit for correct miss behavior and partial understanding of a hit, while deducting for a substantive confusion about what the TLB caches. The score should reflect both the correct component and the misconception.

## Example 10: Page-table entries and TLB reach

**Question:** A process needs 64 KiB of memory. How many page table entries are needed with 4 KiB pages? How many with 64 KiB pages? Why does having fewer entries improve performance?

**Answer under review:** The answer calculates 16 entries with 4 KiB pages and 1 with 64 KiB pages. It explains that fewer entries let mappings fit in the TLB more often, reducing misses and page-table walks.

**Observed score:** 0.9/1

**Calibration decision:** Keep 0.9/1 as a reasonable hard-grade score. Give 1/1 at medium/default grading: the answer gives the correct calculations and explains the practical TLB benefit. It omits the term “TLB reach” (entries multiplied by page size), but describes that concept correctly.

**Preferred judge feedback:** Correctly calculates 16 entries and 1 entry, and explains that fewer entries let the TLB cover the needed memory with fewer misses and page-table walks. This is the benefit of greater TLB reach.

**Rubric implication:** Do not deduct at medium/default strictness for omitting a technical label when the answer clearly explains the concept it names.

## Example 11: Page-size trade-offs for small processes

**Question:** Compare 4 KiB pages and 64 KiB pages for a workload where many processes each use only a small amount of memory. What are the trade-offs?

**Answer under review:** The answer says 4 KiB pages waste less memory for small processes and reduce fragmentation, while 64 KiB pages can improve TLB reach and TLB hit rates at the cost of memory fragmentation.

**Observed score:** 0.9/1

**Calibration decision:** Keep 0.9/1 as a reasonable hard-grade score. Give about 0.95/1 at medium/default grading. The response compares the main memory utilization and translation-performance trade-offs. It does not explicitly mention smaller page tables or say that the best choice depends on the workload, but the core trade-off is clear.

**Preferred judge feedback:** Correctly explains that smaller pages reduce wasted memory for small processes, while larger pages can improve TLB reach and performance at the cost of more fragmentation. A fuller comparison could mention that larger pages also reduce page-table size, and that the best choice depends on the workload's memory and translation needs.

**Rubric implication:** Give strong credit when an answer explains the central trade-offs requested. Treat related consequences and the workload-dependent conclusion as refinements unless the prompt explicitly requires them.

## Proposed default rubric

The app's Balanced preset uses these shared grading rules, followed by its selected strictness guidance and any user preferences:

- Grade against what the question explicitly asks, the reference answer, and its key points.
- Credit equivalent ideas and clear paraphrases. Do not require reference wording or a technical label when the concept is clearly explained.
- Base deductions on requested concepts that are missing or incorrect. Distinguish a substantive omission from a minor precision improvement.
- Do not require optional elaborations or details the question did not ask for. When a prompt asks for a number of examples or conclusions, accept any valid ones that satisfy it.
- Award partial credit in proportion to the requested ideas answered correctly. Give concise feedback that names what is right and the most important gap.
- Give no credit for an empty answer.

Balanced grading gives full credit when the core requests are answered correctly, applies small deductions for minor omissions or imprecision, and deducts proportionally when a substantial part of the prompt is unanswered. Supportive grading reduces deductions for minor gaps; Rigorous grading places more weight on completeness and precision while accepting equivalent correct explanations.

## Rubric version history

### Version 1: Previous default

> Score correctness and conceptual understanding. Give partial credit for mostly correct answers, and require the key ideas from the reference answer. Be concise and explain what is missing.

This version did not explicitly tell the judge to accept equivalent explanations, limit grading to the prompt's requirements, or scale deductions between minor gaps and major omissions.

### Version 2: Balanced calibration default

Version 2 is the proposed default rubric above. It was evaluated on the 11 calibration examples with DeepSeek V4 Flash. The result was **9.9/11**: Questions 1–3, 5, and 7–11 scored 1.0; Question 4 scored 0.5; Question 6 scored 0.4. The user considers Questions 4 and 6 under-credited compared with the agreed medium targets of about 0.7 and 0.6, respectively. Keep this result as a comparison point for the next rubric revision.

The app's rubric check now uses up to 10 recent, unique, answered open questions from the user's quiz history instead of this fixed calibration set. New attempts save the reference answer needed to evaluate grading. Each user's samples remain local to their vault history.
