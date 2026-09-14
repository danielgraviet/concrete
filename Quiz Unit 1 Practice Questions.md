---
type: quiz
source: Stat 220: Statistical Inference — Midterm practice questions, with answers
rubric: "Select the single best answer; focus on signal against noise, p-values, confidence intervals, power, and t-test assumptions."
---

# Quiz Unit 1 Practice Questions

## Q1 · mcq

An A/B test on 40 users per arm reports a 60 percent lift with p = 0.04. What is the strongest reason to wait before shipping?

- [ ] A 60 percent lift is so large that the data is probably mismeasured.
- [x] With low power, effects that reach significance are especially likely to be overestimates (the winner’s curse).
- [ ] A p-value of 0.04 never meets a valid A/B testing standard.
- [ ] The team should have run a one-sided test to obtain a smaller p-value.

## Q2 · mcq

A drug trial reports p = 0.04. What is wrong with saying there is a 4 percent chance the drug does not work?

- [ ] Random assignment makes that probability statement valid.
- [ ] The correct figure is 8 percent because p-values are always one-sided.
- [x] The p-value is the probability of data this extreme given the null, not the probability that the null is true given the data.
- [ ] Nothing; a p-value is the probability that the null hypothesis is true.

## Q3 · mcq

Study A finds a 10-point drop with SE = 8. Study B finds a 2-point drop with SE = 0.5. Which is stronger evidence of a real effect?

- [ ] Study A, because 10 points is five times 2 points.
- [ ] Neither study can be interpreted without pooling them.
- [ ] Study A, because a larger standard error indicates more observations.
- [x] Study B, because its estimate is four standard errors from zero, versus 1.25 for Study A.

## Q4 · mcq

An experiment on 5 million users finds a 0.4-second difference with p < 10^-8. What is the best interpretation?

- [ ] The t-test is invalid at samples in the millions.
- [x] The effect may be real but trivial; the t-statistic grows with the square root of sample size.
- [ ] A tiny p-value means the finding is practically major.
- [ ] A huge sample makes a false alarm more likely.

## Q5 · mcq

A team tests 20 page colours and one has p = 0.04. How excited should you be?

- [x] Not very: testing 20 null effects gives roughly a 64 percent chance of at least one p < 0.05.
- [ ] Very: the other 19 null results validate the green result.
- [ ] Very: any result below 0.05 is equally convincing regardless of how many tests were run.
- [ ] Not at all because p = 0.04 is too close to 0.05 to mean anything.

## Q6 · mcq

A study on 10 participants reports p = 0.40 and concludes the treatment has no effect. What is the problem?

- [ ] A large p-value demonstrates that the treatment does not work.
- [ ] The conclusion is backwards because p = 0.40 proves a large effect.
- [ ] A one-sided test would make the conclusion valid.
- [x] The study may be badly underpowered; inspect the confidence interval before concluding.

## Q7 · mcq

Which statement correctly describes a 95 percent confidence interval?

- [ ] About 95 percent of sample observations fall between its endpoints.
- [ ] There is a 95 percent probability that the true value is in this particular interval.
- [x] In repeated studies, about 95 percent of intervals constructed this way contain the truth.
- [ ] The interval contains the sample mean in 95 percent of repeated studies.

## Q8 · mcq

A dashboard shows conversion rising from 2.0 to 2.4 percent week over week. What should you check first?

- [ ] Announce the 20 percent relative gain.
- [ ] Compare only with the same week last year.
- [ ] Run a two-sample t-test on the two percentages.
- [x] Check counts and the interval, traffic mix, and whether tracking changed.

## Q9 · mcq

A colleague stops an A/B test the moment a live-dashboard p-value drops below 0.05. What does this do?

- [ ] It is safe whenever the instantaneous p-value is below 0.05.
- [x] Every look is another chance to cross the line, so the real false-positive rate rises above 5 percent.
- [ ] It matters only in small experiments.
- [ ] It makes the procedure more conservative.

## Q10 · mcq

You pool 400,000 individual sessions to compare conversion between two cities and obtain t = 31. What is your first concern?

- [ ] A t-statistic above 30 cannot occur with behavioural data.
- [ ] The cities require a paired test.
- [x] Sessions from the same user or city are related, so there are fewer independent observations than rows.
- [ ] No concern: the large t simply reflects reliable estimation.

## Q11 · mcq

Which tests fit these designs: 30 people measured before and after training; 30 trained compared with 30 untrained?

- [ ] Both are unpaired.
- [x] The first is paired; the second is unpaired.
- [ ] The first is unpaired; the second is paired.
- [ ] Both are paired because they study the same program.

## Q12 · mcq

Group A has 2,000 observations with small spread; Group B has 80 with large spread. Which two-sample test should you reach for?

- [ ] Trim both groups to the same size before testing.
- [ ] A paired test, matching rows across groups.
- [ ] The pooled Student test because it has more power.
- [x] Welch’s test, because unequal variances and unequal group sizes make pooling unreliable.

## Q13 · mcq

A t-test on 18 revenue observations includes one enormous purchase and reports p = 0.02. Which assumptions are most strained?

- [ ] None; the central limit theorem resolves the issue at n = 18.
- [x] Normality of the estimate at small n and the condition that no single point dominates.
- [ ] Independence and equality of variances across two groups.
- [ ] Random assignment and blinding of the recorder.

## Q14 · mcq

Which ordering best ranks the damage from failures of equal variances, independence, raw-data normality, and no extreme outliers?

- [ ] Normality, outliers, independence, equal variances.
- [ ] Equal variances, normality, outliers, independence.
- [x] Independence, outliers, equal variance, raw-data normality.
- [ ] They do roughly equal damage.

## Q15 · mcq

Why are p-values uniformly distributed from 0 to 1 when the null is true?

- [ ] The central limit theorem makes every test statistic normal.
- [ ] Null hypotheses are true in about half of published studies.
- [ ] The sampling distribution flattens as sample size grows.
- [x] A p-value is the tail area of the statistic’s own null distribution evaluated at the statistic.

## Q16 · mcq

A manager says a non-significant result means the team can stop investigating. What two situations could have produced it?

- [ ] Only a genuinely zero effect can produce a non-significant result.
- [x] The effect may be genuinely small, or the study may lack power; interval width helps distinguish them.
- [ ] The test must have been one-sided or the sample too small.
- [ ] The wrong test was used, and rerunning it will always settle the question.
