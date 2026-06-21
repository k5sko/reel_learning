"""Pre-vetted channels the topic-search feature draws from.

Only channels whose style clips well (clear speech, segmented explanations)
belong here. For now this is a single test channel; extend the list as more are
vetted. A later knowledge-graph stage will map a broad subject to subtopics and
pick channels per subtopic — for now we just search these directly.
"""

from __future__ import annotations

VETTED_CHANNELS = [
    {
        "name": "The Organic Chemistry Tutor",
        "url": "https://www.youtube.com/@TheOrganicChemistryTutor",
        "subjects": [
            "math", "calculus", "algebra", "trigonometry", "statistics",
            "chemistry", "organic chemistry", "physics",
        ],
    },
    {
        "name": "3Blue1Brown",
        "url": "https://www.youtube.com/@3blue1brown",
        "subjects": [
            "linear algebra", "eigenvalues", "calculus", "neural networks",
            "probability", "topology", "math intuition", "fourier",
        ],
    },
    {
        "name": "Khan Academy",
        "url": "https://www.youtube.com/@khanacademy",
        "subjects": [
            "math", "algebra", "calculus", "linear algebra", "statistics",
            "biology", "chemistry", "physics", "economics", "finance",
        ],
    },
]
