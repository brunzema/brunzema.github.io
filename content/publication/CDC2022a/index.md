---
title: 'On Controller Tuning Using Time-Varying Bayesian Optimization'

# Authors
# If you created a profile for a user (e.g. the default `admin` user), write the username (folder name) here
# and it will be replaced with their full name and linked to their profile.
authors:
  - Paul Brunzema*
  - Alexander von Rohr*
  - Sebastian Trimpe

# # Author notes (optional)
# author_notes:
#   - 'Equal contribution'
#   - 'Equal contribution'

date: '2022-07-01T00:00:00Z'
doi: ''

# Schedule page publish date (NOT publication's date).
publishDate: '2022-12-30T00:00:00Z'

# Publication type.
# Legend: 0 = Uncategorized; 1 = Conference paper; 2 = Journal article;
# 3 = Preprint / Working Paper; 4 = Report; 5 = Book; 6 = Book section;
# 7 = Thesis; 8 = Patent
publication_types: ['1']

# Publication name and optional abbreviated publication name.
publication: In *2022 IEEE 61st Conference on Decision and Control (CDC)*
publication_short: In *CDC*

abstract: Changing conditions or environments can cause system dynamics to vary over time. To ensure optimal control performance, controllers should adapt to these changes. When the underlying cause and time of change is unknown, we need to rely on online data for this adaptation. In this paper, we will use time-varying Bayesian optimization (TVBO) to tune controllers online in changing environments using appropriate prior knowledge on the control objective and its changes. Two properties are characteristic of many online controller tuning problems. First, they exhibit incremental and lasting changes in the objective due to changes to the system dynamics, e.g., through wear and tear. Second, the optimization problem is convex in the tuning parameters. Current TVBO methods do not explicitly account for these properties, resulting in poor tuning performance and many unstable controllers through over-exploration of the parameter space. We propose a novel TVBO forgetting strategy using Uncertainty-Injection (UI), which incorporates the assumption of incremental and lasting changes. The control objective is modeled as a spatio-temporal Gaussian process (GP) with UI through a Wiener process in the temporal domain. Further, we explicitly model the convexity assumptions in the spatial dimension through GP models with linear inequality constraints. In numerical experiments, we show that our model outperforms the state-of-the-art method in TVBO, exhibiting reduced regret and fewer unstable parameter configurations.

# Summary. An optional shortened abstract.
summary: 2022 IEEE 61st Conference on Decision and Control (CDC)

tags: []

# Display this page in the Featured widget?
featured: true

# Custom links (uncomment lines below)
links:
- name: arXiv
  url: https://arxiv.org/abs/2207.11120

# url_pdf: 'https://github.com/wowchemy/wowchemy-hugo-themes'
url_code: 'https://github.com/wowchemy/wowchemy-hugo-themes'
# url_dataset: 'https://github.com/wowchemy/wowchemy-hugo-themes'
# url_poster: ''
# url_project: ''
# url_slides: ''
# url_source: 'https://github.com/wowchemy/wowchemy-hugo-themes'
# url_video: 'https://youtube.com'

# Featured image
# To use, add an image named `featured.jpg/png` to your page's folder.
image:
  caption: 'Image credit: **Paul Brunzema**'
  focal_point: ''
  preview_only: false

# # Associated Projects (optional).
# #   Associate this publication with one or more of your projects.
# #   Simply enter your project's folder or file name without extension.
# #   E.g. `internal-project` references `content/project/internal-project/index.md`.
# #   Otherwise, set `projects: []`.
# projects:
#   - example

# # Slides (optional).
# #   Associate this publication with Markdown slides.
# #   Simply enter your slide deck's filename without extension.
# #   E.g. `slides: "example"` references `content/slides/example/index.md`.
# #   Otherwise, set `slides: ""`.
# slides: example
---

<!-- {{% alert note %}}
Click the _Cite_ button above to demo the feature to enable visitors to import publication metadata into their reference management software.
{{% /alert %}}

{{% alert note %}}
Create your slides in Markdown - click the _Slides_ button to check out the example.
{{% /alert %}}

Supplementary notes can be added here, including [code, math, and images](https://wowchemy.com/docs/writing-markdown-latex/). -->
