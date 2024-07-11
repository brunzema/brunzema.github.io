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

abstract: Bayesian optimization (BO) has proven to be a powerful tool for automatically tuning control parameters without requiring knowledge of the underlying system dynamics. Safe BO methods, in addition, guarantee safety during the optimization process, assuming that the underlying objective function does not change. However, in real-world scenarios, time-variations frequently occur, for example, due to wear in the system or changes in operation. Utilizing standard safe BO strategies that do not address time-variations can result in failure as previous safe decisions may become unsafe over time, which we demonstrate herein. To address this, we introduce a new algorithm, Event-Triggered SafeOpt (ETSO), which adapts to changes online solely relying on the observed costs. At its core, ETSO uses an event trigger to detect significant deviations between observations and the current surrogate of the objective function. When such change is detected, the algorithm reverts to a safe backup controller, and exploration is restarted. In this way, safety is recovered and maintained across changes. We evaluate ETSO on quadcopter controller tuning, both in simulation and hardware experiments. ETSO outperforms state-of-the-art safe BO, achieving superior control performance over time while maintaining safety.

# Summary. An optional shortened abstract.
summary: 6th Annual Learning for Dynamics & Control Conference

tags: []
featured: false

links:
- name: arXiv
  url: https://arxiv.org/abs/2312.08058
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
