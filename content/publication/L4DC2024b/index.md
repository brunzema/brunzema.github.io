---
title: "Event-Triggered Safe Bayesian Optimization on Quadcopters"
authors:
  - Antonia Holzapfel*
  - Paul Brunzema*
  - Sebastian Trimpe
date: "2023-12-10T00:00:00Z"
doi: ""

# Schedule page publish date (NOT publication's date).
publishDate: "2017-01-01T00:00:00Z"

# Publication type.
# Legend: 0 = Uncategorized; 1 = Conference paper; 2 = Journal article;
# 3 = Preprint / Working Paper; 4 = Report; 5 = Book; 6 = Book section;
# 7 = Thesis; 8 = Patent
publication_types: ["1"]

# Publication name and optional abbreviated publication name.
publication: ""
publication_short: ""

abstract: Traditionally, first-principle models are used to monitor and control dynamical systems. However, modeling complex systems using first principles can be challenging. Learning the dynamics from data using neural networks has emerged as a viable alternative. In practice, some parameters of a system may vary across different system instances, but training separate neural networks for all possible parameter combinations can be infeasible. Therefore, meta-learning using, e.g., conditional neural processes (CNPs), aims to learn a prior model over the system dynamics for various parameters. These models can then adapt on deployment to the parameters of a system instance using a context set composed of past observations. However, changes in parameters can also occur online during operation and naively adding past observations across parameter variations to the context set can distort the model’s latent representation, leading to inaccurate predictions over time. This paper introduces an adaptation scheme to enable CNPs to cope with such online variations. We combine a sliding window to accommodate gradual variations with the use of event triggers to detect sudden changes. The event triggers are based on concentration inequalities, they reset the context set of the CNP once observations deviate significantly from the CNP’s predictions. We validate our concepts on two nonlinear dynamical systems under parameter variations and demonstrate that our approaches decrease the prediction error over time as well as their efficacy for control.
# Summary. An optional shortened abstract.

summary: 6th Annual Learning for Dynamics & Control Conference

tags: []
featured: false

links:
- name: Proceedings
  url: https://proceedings.mlr.press/v242/brunzema24a.html
# url_pdf: http://arxiv.org/pdf/1512.04133v1
# url_code: 'https://github.com/wowchemy/wowchemy-hugo-themes'
# url_dataset: '#'
# url_poster: '#'
# url_project: ''
# url_slides: ''
# url_source: '#'
# url_video: '#'

# Featured image
# To use, add an image named `featured.jpg/png` to your page's folder. 
image:
  caption: 'Image credit: **Paul Brunzema**'
  focal_point: ""
  preview_only: false

# # Associated Projects (optional).
# #   Associate this publication with one or more of your projects.
# #   Simply enter your project's folder or file name without extension.
# #   E.g. `internal-project` references `content/project/internal-project/index.md`.
# #   Otherwise, set `projects: []`.
# projects:
# - internal-project

# # Slides (optional).
# #   Associate this publication with Markdown slides.
# #   Simply enter your slide deck's filename without extension.
# #   E.g. `slides: "example"` references `content/slides/example/index.md`.
# #   Otherwise, set `slides: ""`.
# slides: example
---
<!-- 
{{% alert note %}}
Create your slides in Markdown - click the *Slides* button to check out the example.
{{% /alert %}}

Supplementary notes can be added here, including [code, math, and images](https://wowchemy.com/docs/writing-markdown-latex/). -->
