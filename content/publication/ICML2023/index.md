---
title: "Event-Triggered Time-Varying Bayesian Optimization"
authors:
  - Paul Brunzema
  - Alexander von Rohr
  - Friedrich Solowjow
  - Sebastian Trimpe
date: "2022-12-31T00:00:00Z"
doi: ""

# Schedule page publish date (NOT publication's date).
publishDate: "2017-01-01T00:00:00Z"

# Publication type.
# Legend: 0 = Uncategorized; 1 = Conference paper; 2 = Journal article;
# 3 = Preprint / Working Paper; 4 = Report; 5 = Book; 6 = Book section;
# 7 = Thesis; 8 = Patent
publication_types: ["3"]

# Publication name and optional abbreviated publication name.
publication: ""
publication_short: ""

abstract: We consider the problem of sequentially optimizing a time-varying objective function using time-varying Bayesian optimization (TVBO). Here, the key challenge is to cope with old data. Current approaches to TVBO require prior knowledge of a constant rate of change. However, the rate of change is usually neither known nor constant. We propose an event-triggered algorithm, ET-GP-UCB, that detects changes in the objective function online. The event-trigger is based on probabilistic uniform error bounds used in Gaussian process regression. The trigger automatically detects when significant change in the objective functions occurs. The algorithm then adapts to the temporal change by resetting the accumulated dataset. We provide regret bounds for ET-GP-UCB and show in numerical experiments that it is competitive with state-of-the-art algorithms even though it requires no knowledge about the temporal changes. Further, ET-GP-UCB outperforms these competitive baselines if the rate of change is misspecified and we demonstrate that it is readily applicable to various settings without tuning hyperparameters.

# Summary. An optional shortened abstract.
summary: arXiv 2022

tags: []
featured: false

links:
- name: arXiv
  url: https://arxiv.org/abs/2208.10790
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
