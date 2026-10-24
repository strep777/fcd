// Wait for the selected workflow button's real colors, including CSS transitions.
// This also prevents hidden compositor captures from recording the previous tab.
export async function settleWorkflowNavigation(page, stage) {
  await page.waitForFunction(stage => {
    const buttons = [...document.querySelectorAll('.workflow-nav > button[data-stage]')];
    const selected = buttons.filter(button => button.classList.contains('active'));
    if (selected.length !== 1 || selected[0].dataset.stage !== stage || selected[0].getAttribute('aria-current') !== 'step') return false;
    if (buttons.some(button => button.getAnimations().some(animation => animation.playState !== 'finished'))) return false;
    const context = document.createElement('canvas').getContext('2d');
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    const expected = context.fillStyle;
    context.fillStyle = getComputedStyle(selected[0]).backgroundColor;
    return context.fillStyle === expected;
  }, stage);
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll('button')].flatMap(button => button.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  return page.locator('.workflow-nav > button[data-stage].active').evaluate(button => ({
    stage: button.dataset.stage,
    current: button.getAttribute('aria-current'),
    background: getComputedStyle(button).backgroundColor,
    color: getComputedStyle(button).color,
  }));
}
