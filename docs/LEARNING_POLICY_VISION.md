# Learning Policy Vision

## Thesis

Use reinforcement-learning ideas to improve human learning—not merely to add an LLM chatbot.

The app should treat learning as a partially observed control problem. It continually estimates what the learner knows and chooses the next action to improve long-term retention.

The system should decide:

- What to show next
- When to review it
- How difficult the question should be
- Whether to give a hint
- Whether to introduce a related concept
- When to stop drilling and switch contexts
- Whether the learner is confused, guessing, bored, or genuinely mastering the material

## Learning state

The learner model may include:

- Estimated knowledge
- Confidence
- Response latency
- Error patterns
- Recent fatigue
- Topic dependencies
- Review history

## Learning actions

Possible actions include:

- Recall question
- Recognition question
- Cloze exercise
- Explanation
- Worked example
- Hint
- Harder variant
- Prerequisite review
- Topic switch

## Reward signals

Immediate correctness is not enough. A correct answer after guessing or using a hint should be different from independent recall.

Useful signals include:

- Delayed retention
- Transfer to new questions
- Reduced hint dependence
- Confidence calibration
- Low frustration
- Sustained engagement

The system should optimize for durable understanding, not merely short-term quiz accuracy.

## Explore versus exploit

Most study systems exploit: if a learner misses a card, they show the same card again.

A stronger system explores the learner's knowledge boundary by changing the formulation, context, difficulty, or task type. It may:

- Try a harder formulation
- Change the context
- Ask for an explanation instead of recognition
- Test a prerequisite
- Ask for application in a new domain
- Compare two easily confused concepts

Exploration should be controlled. It should target areas with high uncertainty or information gain rather than feel random or demoralizing.

An initial policy can be expressed as a contextual bandit:

```text
choose the next exercise that maximizes:

expected learning gain
+ information gain about the learner
- frustration cost
- repetition cost
```

Start with a contextual bandit rather than full RL. A true sequential policy can come later, after collecting reliable longitudinal data.

## RLVR for learning

RLVR maps naturally to education, but the verifier must evaluate more than final-answer matching.

For each response, the verifier may check:

- Final answer correctness
- Reasoning validity
- Use of required concepts
- Transfer to a changed example
- Whether confidence matched correctness
- Whether the learner relied on hints
- Whether the response was copied from source material

Verification should be concrete wherever possible. Math and programming can use executable or symbolic checks. History, science, and writing can combine rubrics, reference answers, citations, contradiction checks, and teacher-defined criteria.

The system must not reward an LLM merely for producing a plausible explanation. The learner's demonstrated behavior is the ground truth.

## MCTS for instructional paths

Monte Carlo Tree Search may help plan a short instructional sequence rather than select every keystroke.

For example:

```text
definition → trace example → easy exercise → harder exercise
definition → prerequisite review → visual analogy → exercise
definition → misconception probe → targeted explanation → exercise
```

Rollouts can estimate:

- Probability of mastery
- Expected retention
- Frustration
- Time cost
- Information gained

MCTS may be useful for planning a study session, selecting a topic sequence, recovering a struggling learner, planning a quiz, or deciding when to move from instruction to retrieval.

It should not be used everywhere. Simple, transparent policies are preferable for immediate interactions.

## System architecture

Separate the system into four layers:

1. **Content layer** — Markdown notes, concepts, examples, questions, and prerequisites.
2. **Learner model** — Per-concept estimates such as mastery, stability, confidence, fluency, and misconception likelihood.
3. **Policy layer** — Chooses the next learning action using scheduling, bandits, and eventually MCTS.
4. **Verifier/evaluator layer** — Determines whether the learner actually demonstrated understanding.

The LLM belongs mostly in content transformation and evaluation:

- Generate candidate questions
- Produce alternate explanations
- Identify misconceptions
- Create distractors
- Suggest prerequisite relationships

The policy should not be delegated blindly to the LLM. It should be measurable, inspectable, and eventually trainable from logged outcomes.

## First experiment

Start with one concept and three exercise types:

- Recall
- Explain
- Apply

Log every attempt in a structured form:

```json
{
  "concept": "recursion",
  "exercise_type": "apply",
  "correct": true,
  "confidence": 3,
  "latency_ms": 18400,
  "hints_used": 0,
  "transfer_test": null
}
```

Compare:

1. Fixed spaced repetition
2. Difficulty-based selection
3. Information-gain selection

Measure:

- Delayed recall after one day and seven days
- Transfer performance
- Time to mastery
- Hint dependence
- Confidence calibration
- Dropout and frustration signals

This creates an empirical foundation rather than vague personalization claims.

## Product principle

Call the first version an **adaptive learning policy engine**, not an RL system. Begin with transparent heuristics and contextual bandits. Once the state representation, rewards, and evaluation protocol are trustworthy, introduce more advanced RL methods.

The core advantage should be:

> The app learns how to teach each person, while the learner learns the subject.

## Ownership constraint

This vision is a product decision owned by the creator. AI may help implement, generate candidates, or analyze evidence, but it must not silently decide the learning objective, reward function, policy, or definition of mastery.

