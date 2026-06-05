export const MERMAID_CONFIG = {
  startOnLoad: false,
  theme: "default" as const,
  securityLevel: "loose" as const,
  htmlLabels: true,
  flowchart: {
    htmlLabels: true,
    useMaxWidth: false,
    padding: 12,
    nodeSpacing: 90,
    rankSpacing: 26,
  },
  class: { htmlLabels: false },
  state: { htmlLabels: false },
  sequence: { useMaxWidth: false },
  gantt: { useMaxWidth: false },
};
