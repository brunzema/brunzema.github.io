# Stein variational inference — research note

Primary notation recommendation for the visual article:

- target density: \(p(x)=\bar p(x)/Z\)
- evolving approximation: \(q_t\)
- particles: \(x_i^t\), \(i=1,\ldots,n\)
- target score: \(s_p(x)=\nabla_x\log p(x)=\nabla_x\log\bar p(x)\)
- kernel: \(k_h(x,y)\)
- transport field: \(\phi_t(x)\)

This keeps \(p\) reserved for the target and \(q\) for the approximation throughout. The score does not depend on the unknown normalizing constant \(Z\), which is why the method applies to unnormalized posteriors. [[Liu & Wang, 2016, §§2–3](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]

## 1. The problem is distributional, not point optimization

SVGD begins with particles \(\{x_i^0\}_{i=1}^n\), often sampled from an easy \(q_0\), and repeatedly applies a shared near-identity map

\[
T_\epsilon(x)=x+\epsilon\phi(x).
\]

The population distribution is pushed forward as \(q_{t+1}=(T_{\epsilon_t})_\#q_t\); the implementation applies the same map to every particle. With one particle and a kernel satisfying \(k(x,x)=1\) and \(\nabla_1 k(x,x)=0\), such as the RBF, SVGD reduces to score ascent toward a MAP point. Multiple interacting particles are what turn it into an approximate inference method rather than an optimizer for one mode. [[Liu & Wang, 2016, Algorithm 1 and §3.2](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]

## 2. Stein identity: a target-aware zero

For a smooth vector field \(\phi:\mathbb R^d\to\mathbb R^d\), define the scalar Langevin–Stein operator

\[
\mathcal A_p\phi(x)
=s_p(x)^\top\phi(x)+\nabla_x\!\cdot\phi(x).
\]

Under the required boundary/decay conditions,

\[
\mathbb E_{x\sim p}[\mathcal A_p\phi(x)]=0.
\]

This follows by integration by parts. Under another distribution \(q\), the expectation is generally nonzero, so its largest value over a controlled function class measures violation of the identity. The boundary condition is part of the theorem and should not disappear from a mathematical deep dive. [[Liu, Lee & Jordan, 2016, §2](https://proceedings.mlr.press/v48/liub16.html)]

For the unit ball of a vector-valued RKHS \(\mathcal H^d\), the kernelized Stein discrepancy (KSD) is

\[
\mathbb D_k(q,p)
=\sup_{\|\phi\|_{\mathcal H^d}\le 1}
\mathbb E_q[\mathcal A_p\phi]
=\|\phi^*_{q,p}\|_{\mathcal H^d},
\]

with an unnormalized optimal witness / transport field

\[
\phi^*_{q,p}(\,\cdot\,)
=\mathbb E_{x\sim q}\!\left[
k(x,\,\cdot\,)s_p(x)+\nabla_x k(x,\,\cdot\,)
\right].
\]

The normalized unit-ball optimizer is \(\phi^*/\|\phi^*\|\). Keeping “witness,” “unit direction,” and “SVGD update field” distinct avoids a common hidden normalization inconsistency. [[Liu, Lee & Jordan, 2016, Theorem 3.8](https://proceedings.mlr.press/v48/liub16.html); [Liu & Wang, 2016, eqs. (2)–(6)](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]

## 3. Why this field is a descent direction

For the pushed-forward density \((T_\epsilon)_\#q\), the first variation of KL is

\[
\left.
\frac{\mathrm d}{\mathrm d\epsilon}
\operatorname{KL}((T_\epsilon)_\#q\,\|\,p)
\right|_{\epsilon=0}
=-\mathbb E_q[\mathcal A_p\phi].
\]

Therefore \(\phi^*\) gives the steepest local decrease allowed by the RKHS geometry. Along the unnormalized field,

\[
\left.
\frac{\mathrm d}{\mathrm d\epsilon}
\operatorname{KL}((T_\epsilon)_\#q\,\|\,p)
\right|_{\epsilon=0,\,\phi=\phi^*}
=-\mathbb D_k(q,p)^2.
\]

Along the normalized unit direction, the derivative is instead \(-\mathbb D_k(q,p)\). SVGD is thus a KL gradient flow in a kernel/Stein-induced geometry, not ordinary Euclidean gradient descent on the concatenated particle coordinates. [[Liu & Wang, 2016, Theorem 3.1 and Lemma 3.2](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf); [Liu, 2017](https://proceedings.neurips.cc/paper/2017/hash/17ed8abedc255908be746d245e50263a-Abstract.html)]

The empirical update replaces the expectation under \(q_t\) by the current particle average:

\[
x_i^{t+1}=x_i^t+\epsilon_t\widehat\phi_t(x_i^t),
\]

\[
\widehat\phi_t(z)
=\frac1n\sum_{j=1}^n\left[
k(x_j^t,z)s_p(x_j^t)
+\nabla_{x_j^t}k(x_j^t,z)
\right].
\]

The pairwise kernel calculation costs \(O(n^2)\) without approximation. The population KL calculation motivates the particle rule, but the finite empirical measure itself is discrete and should not be presented as having a directly plotted finite KL against a continuous target. [[Liu & Wang, 2016, Algorithm 1 and §3.2](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf); [Korba et al., 2020](https://papers.nips.cc/paper_files/paper/2020/hash/3202111cf90e7c816a472aaceb72b0df-Abstract.html)]

## 4. Attraction and repulsion are one coupled field

At particle \(x_i\), split the empirical field into

\[
\underbrace{\frac1n\sum_j k(x_j,x_i)s_p(x_j)}_{
\text{kernel-smoothed target score}}
\quad+\quad
\underbrace{\frac1n\sum_j\nabla_{x_j}k(x_j,x_i)}_{
\text{kernel repulsion}}.
\]

The first term shares score information between neighboring particles and drives mass toward high-density regions. The second prevents particles from simply collapsing onto modes. They are not independent objectives or arbitrary forces: together they are the RKHS-optimal KL descent field. [[Liu & Wang, 2016, §3.2](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]

### RBF sign convention

The original paper uses

\[
k_h(x,y)=\exp\!\left(-\frac{\|x-y\|^2}{h}\right).
\]

Differentiating with respect to the **first** argument gives

\[
\nabla_x k_h(x,y)
=-\frac{2}{h}(x-y)k_h(x,y)
=\frac{2}{h}(y-x)k_h(x,y).
\]

Hence the term used to update particle \(i\) is

\[
\nabla_{x_j}k_h(x_j,x_i)
=\frac{2}{h}(x_i-x_j)k_h(x_j,x_i),
\]

which points from neighbor \(j\) toward particle \(i\): it pushes \(i\) away from \(j\). Differentiating with respect to the second argument without changing the sign is a visualization/implementation bug. With the alternative convention \(k_\sigma(x,y)=\exp(-\|x-y\|^2/(2\sigma^2))\), the coefficient is \(1/\sigma^2\), not \(2/h\). Pick one convention and keep it everywhere. [[Liu & Wang, 2016, §3.2](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]

## 5. Bandwidth is part of the behavior

For their \(\exp(-\|x-y\|^2/h)\) convention, Liu and Wang used the adaptive heuristic

\[
h=\frac{\operatorname{med}^2}{\log n},
\]

where \(\operatorname{med}\) is the median pairwise particle distance. They motivate it as roughly balancing a particle’s own gradient contribution with influence from other particles; they do not prove it is optimal. The bandwidth changes over iterations as the particles move. [[Liu & Wang, 2016, §5](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]

For distinct particles, \(h\to0\) disconnects neighbors and the repulsive term vanishes, leaving approximately independent score ascent and mode collapse. At the other extreme, \(h\to\infty\) also shrinks the RBF kernel gradient through its \(1/h\) factor. The useful regime lies between these extremes. In high dimension, standard isotropic distance kernels can produce weakened repulsion and particle variance collapse; this is a documented limitation, not a universal convergence behavior. [[Liu & Wang, 2016, §3.2](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf); [Zhuo et al., 2018](https://proceedings.mlr.press/v80/zhuo18a.html)]

## 6. What the article may and may not claim about convergence

Safe claims:

- Under Stein-class regularity, the infinitesimal population update in \(\phi^*\) decreases KL at instantaneous rate \(\mathbb D_k(q,p)^2\). [[Liu & Wang, 2016](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]
- Later work gives finite-step population descent lemmas and rates for average Stein Fisher information/KSD under explicit smoothness and boundedness assumptions, plus finite-particle-to-population approximation results. [[Korba et al., 2020](https://papers.nips.cc/paper_files/paper/2020/hash/3202111cf90e7c816a472aaceb72b0df-Abstract.html)]
- A finite-particle convergence rate in KSD is available under conditions including a sub-Gaussian target, Lipschitz score, and an appropriate step-size sequence. [[Shi & Mackey, 2023](https://proceedings.neurips.cc/paper_files/paper/2023/file/54e5d7af6250ccab796ad7fe75663ba5-Paper-Conference.pdf)]

Claims to avoid:

- “Every SVGD run converges to the target.” Theory depends on the target, kernel, regularity, initialization/particle approximation, and step sizes. [[Korba et al., 2020](https://papers.nips.cc/paper_files/paper/2020/hash/3202111cf90e7c816a472aaceb72b0df-Abstract.html); [Shi & Mackey, 2023](https://proceedings.neurips.cc/paper_files/paper/2023/file/54e5d7af6250ccab796ad7fe75663ba5-Paper-Conference.pdf)]
- “KL decreases at every displayed finite step.” The basic identity is infinitesimal; finite-step monotonicity needs additional conditions and a sufficiently controlled step. [[Liu & Wang, 2016](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf); [Korba et al., 2020](https://papers.nips.cc/paper_files/paper/2020/hash/3202111cf90e7c816a472aaceb72b0df-Abstract.html)]
- “A small KSD always proves weak convergence.” Common rapidly decaying kernels can fail to detect non-convergence, even for Gaussian targets; in dimension \(d\ge3\), RBF-based KSD can be misleading for non-tight sequences. [[Gorham & Mackey, 2017](https://proceedings.mlr.press/v70/gorham17a.html)]
- “Finite particles are independent posterior samples.” Their deterministic pairwise interaction is precisely what creates diversity, so the particles are dependent. [[Liu & Wang, 2016, §3.2](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]
- “Repulsion guarantees mode discovery.” High-dimensional collapse and weakening repulsion have been observed and analyzed. [[Zhuo et al., 2018](https://proceedings.mlr.press/v80/zhuo18a.html)]

There is also a subtle distinction between \(\mathbb D_k(q,p)=0\) identifying \(q=p\) for suitable fixed distributions/kernels and a sequence with \(\mathbb D_k(q_m,p)\to0\) necessarily converging weakly to \(p\). The latter is strictly stronger and can fail for common kernels. [[Liu, Lee & Jordan, 2016](https://proceedings.mlr.press/v48/liub16.html); [Gorham & Mackey, 2017](https://proceedings.mlr.press/v70/gorham17a.html)]

## 7. Visualization-friendly narrative

### A. One point becomes a population

Use a 2-D two-mode target with a particle-count control. At \(n=1\), show the kernel derivative vanish on the diagonal and the point climb the target score toward one mode. As particles are added, show the same target-score layer plus the emerging pairwise repulsion, ending in a cloud that represents uncertainty. This makes the optimization-to-inference transition visually immediate. The one-particle/MAP fact and the original 1-D Gaussian-mixture experiment are in [[Liu & Wang, 2016, §§3.2 and 5](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)].

Suggested encodings:

- target density: subdued contours
- score term: blue arrows
- repulsive term: orange arrows/arcs
- resultant SVGD step: bright neutral arrow
- particles: outlined dots whose tails show transport, not stochastic trajectories

### B. Force microscope for one selected particle

Let the reader select particle \(i\). Draw, for every neighbor \(j\), the two messages

\[
k(x_j,x_i)s_p(x_j)
\quad\text{and}\quad
\nabla_{x_j}k(x_j,x_i),
\]

then animate their vector sums into \(\widehat\phi(x_i)\). Toggle “score only,” “repulsion only,” and “together.” A bandwidth slider can reveal disconnected particles at small \(h\), a useful neighborhood at medium \(h\), and near-global but weakly differentiated coupling at large \(h\). This directly depicts Algorithm 1 rather than using a metaphor. [[Liu & Wang, 2016, Algorithm 1](https://proceedings.neurips.cc/paper/2016/file/b3ba8f1bee1238a2f37603d90b58898d-Paper.pdf)]

### C. The high-dimensional trap

Keep the visible two coordinates fixed while a dimension control adds hidden nuisance coordinates. Alongside the 2-D projection, show the distribution of pairwise distances, off-diagonal kernel weights, mean repulsion magnitude, and marginal particle variance. As dimension rises, distances concentrate and repulsion weakens/collapse becomes visible. This is a more honest high-dimensional view than suggesting that a 2-D projection alone shows full particle quality. [[Zhuo et al., 2018](https://proceedings.mlr.press/v80/zhuo18a.html)]

The strongest cohesive sequence is **target score → Stein identity → optimal field → particle messages → bandwidth → high-dimensional caveat**. It moves from “what information is available?” to “why this update?” to “how it behaves?” and finally “where it can fail.”

## Primary sources

1. Qiang Liu and Dilin Wang, [“Stein Variational Gradient Descent: A General Purpose Bayesian Inference Algorithm”](https://proceedings.neurips.cc/paper/2016/hash/b3ba8f1bee1238a2f37603d90b58898d-Abstract.html), NeurIPS 2016.
2. Qiang Liu, Jason Lee, and Michael I. Jordan, [“A Kernelized Stein Discrepancy for Goodness-of-fit Tests”](https://proceedings.mlr.press/v48/liub16.html), ICML 2016.
3. Qiang Liu, [“Stein Variational Gradient Descent as Gradient Flow”](https://proceedings.neurips.cc/paper/2017/hash/17ed8abedc255908be746d245e50263a-Abstract.html), NeurIPS 2017.
4. Jackson Gorham and Lester Mackey, [“Measuring Sample Quality with Kernels”](https://proceedings.mlr.press/v70/gorham17a.html), ICML 2017.
5. Jingwei Zhuo et al., [“Message Passing Stein Variational Gradient Descent”](https://proceedings.mlr.press/v80/zhuo18a.html), ICML 2018.
6. Anna Korba et al., [“A Non-Asymptotic Analysis for Stein Variational Gradient Descent”](https://papers.nips.cc/paper_files/paper/2020/hash/3202111cf90e7c816a472aaceb72b0df-Abstract.html), NeurIPS 2020.
7. Jiaxin Shi and Lester Mackey, [“A Finite-Particle Convergence Rate for Stein Variational Gradient Descent”](https://proceedings.neurips.cc/paper_files/paper/2023/file/54e5d7af6250ccab796ad7fe75663ba5-Paper-Conference.pdf), NeurIPS 2023.
