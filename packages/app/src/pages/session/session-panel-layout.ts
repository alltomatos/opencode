export function sessionPanelLayout(input: { review: boolean; terminal: boolean; files: boolean; browser?: boolean }) {
  const otherVisible = input.review || input.terminal || input.files
  const browserVisible = !!input.browser
  return {
    visible: otherVisible || browserVisible,
    stacked: (input.review && input.terminal) || (browserVisible && otherVisible),
  }
}
