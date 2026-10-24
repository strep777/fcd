import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs, executablePath, testedBuild} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {hiddenWindowId} from './desktop-window.mjs';
import {chooseProject} from './ui-navigation.mjs';
import {assertSurfaceRendered} from './surface-renderer.mjs';
import {settleWorkflowNavigation} from './workflow-navigation-style.mjs';

// Run only after the implementation and its production build are complete.
// The real Tauri renderer and compositor stay hidden throughout this suite.
const output = resolve('test-results/current-task-closed/apple-ui-representative');
await mkdir(output, {recursive: true});
const directory = await mkdtemp(resolve('.local/tests/apple-ui-'));
const env = {...process.env, FPCAD_DATA_DIR: directory};

const sizes = [{width: 1280, height: 800}, {width: 1920, height: 1080}, {width: 1000, height: 680}];
const stages = ['guide', 'references', 'marking-edit', 'model', 'mapping', 'cutting', 'assembly', 'pattern'];
const labels = {
  zh: ['使用指南', '花纹提取', '花纹修改', '模型管理', '花纹映射', '裁切版型', '拼接预览', '制版'],
  en: ['Guide', 'Pattern extraction', 'Edit markings', 'Model management', 'Pattern mapping', 'Cutting', 'Cut assembly', 'Pattern making'],
  ja: ['ガイド', '模様の抽出', '模様の編集', 'モデル管理', '模様のマッピング', '裁断', '組み立てプレビュー', '型紙作成'],
};
const app = await desktop.launch({args: desktopArgs, executablePath, env});
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const errors = [], checks = [], screenshots = [], navigationMetrics = [], captureAttempts = [];
let fatal;
page.on('pageerror', error => errors.push({type: 'pageerror', message: error.message}));
page.on('console', message => {
  if (message.text().includes('[Vue warn]')) errors.push({type: 'vue', message: message.text()});
});

async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

// Retain every layout and business check; capture one complete representative
// workflow plus every failure rather than duplicating 145 compositor captures.
async function capture(name) {
  if (!name.startsWith('zh-1280x800-') && name !== 'reduced-motion-model' && !name.endsWith('-failure') && name !== 'fatal') return;
  await hiddenWindowId(app, page);
  const active = page.locator('.workflow-nav > button[data-stage].active');
  const current = await active.count() ? await active.getAttribute('data-stage') : null;
  if (current) await settleWorkflowNavigation(page, current);
  const path = resolve(output, `${name}.png`);
  let image;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      image = await desktopScreenshot(app, page, {path, scale: 'css'});
      break;
    } catch (error) {
      captureAttempts.push({name, attempt, error: error.stack ?? String(error)});
      if (!String(error).includes('UnknownVizError') || attempt === 3) throw error;
      await settle();
    }
  }
  assert(image.length > 500, `${name}: compositor screenshot must contain image data`);
  screenshots.push(path);
}

async function inspectLayout(selector, minimumHeight = 180) {
  await settle();
  const result = await page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      viewport: {width: innerWidth, height: innerHeight},
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      bounds: rect && {x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom},
      footerTop: document.querySelector('.app-shell > footer')?.getBoundingClientRect().top,
    };
  });
  assert(result.documentWidth <= result.viewport.width + 1, `${selector}: document overflows horizontally: ${JSON.stringify(result)}`);
  assert(result.bodyWidth <= result.viewport.width + 1, `${selector}: body overflows horizontally`);
  assert(result.bounds, `${selector}: expected visible content bounds`);
  assert(result.bounds.width >= 200, `${selector}: content width must remain usable`);
  assert(result.bounds.height >= minimumHeight, `${selector}: visible content height must be at least ${minimumHeight}px: ${JSON.stringify(result)}`);
  assert(result.bounds.x >= -1 && result.bounds.x + result.bounds.width <= result.viewport.width + 1, `${selector}: content must fit horizontally`);
  assert(result.bounds.y >= 0 && result.bounds.bottom <= result.viewport.height + 1, `${selector}: content must stay within viewport`);
  return result;
}

async function check(name, run) {
  try {
    const detail = await run();
    await capture(name);
    checks.push({name, passed: true, detail});
  } catch (error) {
    checks.push({name, passed: false, error: error.stack ?? String(error)});
    await capture(`${name}-failure`).catch(captureError => errors.push({type: 'capture', message: String(captureError)}));
  }
}

async function stage(key) {
  await page.locator(`.workflow-nav > button[data-stage="${key}"]`).click();
  await page.locator(`.workspace.page-${key}:visible`).waitFor();
  await settleWorkflowNavigation(page, key);
  await settle();
}

async function selectLanguage(locale) {
  await page.getByLabel('Language', {exact: true}).selectOption(locale);
  await settle();
}

try {
  await page.waitForFunction(() => !!window.fpcad && !!document.querySelector('.welcome-content'));
  await hiddenWindowId(app, page);

  // Empty home and create/cancel are exercised before seeding any project.
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const locale of Object.keys(labels)) {
      await selectLanguage(locale);
      const prefix = `${locale}-${size.width}x${size.height}`;
      await check(`${prefix}-home`, () => inspectLayout('.welcome'));
      await page.locator('.welcome-content button.primary').first().click();
      await page.getByRole('dialog').waitFor();
      await check(`${prefix}-new-dialog`, async () => {
        const input = page.getByRole('dialog').locator('input').first();
        await input.fill('Apple UI · 真实毫米项目');
        assert(await input.evaluate(element => document.activeElement === element), 'new project name receives keyboard focus');
        assert.equal(await page.getByRole('dialog').getAttribute('aria-modal'), 'true');
        return inspectLayout('[role="dialog"]', 150);
      });
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0, 'Escape closes the new project dialog without creating a project');
    }
  }

  // Persistence uses the controlled API and real project contracts. A two-face
  // surface needs no native solver and keeps this suite about UI behavior.
  const seeded = await page.evaluate(async () => {
    let result = await window.fpcad.create({name: 'Apple UI · 毫米工作区', unit: 'mm'});
    if (!result.ok) return result;
    const vertices = [[0, 0, 0], [200, 0, 0], [200, 300, 0], [0, 300, 0]]
      .map(([xMm, yMm, zMm]) => ({id: crypto.randomUUID(), xMm, yMm, zMm}));
    const surface = {
      id: crypto.randomUUID(), topologyVersion: 1, source: 'obj', vertices,
      faces: [[0, 1, 2], [0, 2, 3]].map(indices => ({id: crypto.randomUUID(), vertices: indices.map(index => vertices[index].id), region: 'body'})),
    };
    return window.fpcad.apply(result.data.project.id, result.data.project.revision, {type: 'surface.set', surface});
  });
  assert(seeded.ok, JSON.stringify(seeded));
  const initialRevision = seeded.data.project.revision;
  await page.reload();
  await chooseProject(page);

  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const locale of Object.keys(labels)) {
      await selectLanguage(locale);
      const prefix = `${locale}-${size.width}x${size.height}`;
      await check(`${prefix}-navigation`, async () => {
        const metrics = await page.locator('.workflow-nav').evaluate(nav => ({
          clientHeight: nav.clientHeight, scrollHeight: nav.scrollHeight, clientWidth: nav.clientWidth, scrollWidth: nav.scrollWidth,
          top: nav.getBoundingClientRect().top, bottom: nav.getBoundingClientRect().bottom,
          flexWrap: getComputedStyle(nav).flexWrap,
          buttons: [...nav.querySelectorAll('button[data-stage]')].map(button => {
            const rect = button.getBoundingClientRect();
            return {stage: button.dataset.stage, x: rect.x, y: rect.y, width: rect.width, height: rect.height};
          }),
        }));
        navigationMetrics.push({locale, size, ...metrics});
        if (size.width <= 1000) {
          assert.equal(metrics.flexWrap, 'nowrap', 'compact navigation keeps every workflow button on one scrollable row');
          assert(metrics.buttons.every(button => button.y >= metrics.top && button.y + button.height <= metrics.bottom + 1), 'compact navigation must not vertically clip workflow buttons');
          assert(Math.max(...metrics.buttons.map(button => button.y)) - Math.min(...metrics.buttons.map(button => button.y)) <= 1, 'compact workflow buttons share one row');
        }
        assert.deepEqual(await page.locator('.workflow-nav > button[data-stage]').evaluateAll(buttons => buttons.map(button => button.dataset.stage)), stages);
        assert.deepEqual(await page.locator('.workflow-nav .stage-label').allTextContents(), labels[locale]);
        return inspectLayout('.workspace:visible');
      });
      for (const key of stages) {
        await stage(key);
        await check(`${prefix}-${key}`, async () => {
          const active = page.locator('.workflow-nav > button[data-stage].active');
          assert.equal(await active.count(), 1, 'only the current workflow stage is selected');
          assert.equal(await active.getAttribute('data-stage'), key);
          assert.equal(await active.getAttribute('aria-current'), 'step');
          const bounds = await inspectLayout(`.workspace.page-${key}`);
          const selectedStyle = await settleWorkflowNavigation(page, key);
          assert.equal(selectedStyle.color, 'rgb(255, 255, 255)', 'the selected stage must settle to its white label and primary background');
          if (key === 'marking-edit') {
            const emptyHeadings = {zh: '先提取花纹，再在这里补全', en: 'Extract a marking, then complete it here', ja: '模様を抽出して、ここで補完できます'};
            assert.equal(await page.locator('.edit-empty h2').innerText(), emptyHeadings[locale]);
            assert.equal(await page.locator('.marking-edit-page .source-region-editor,.edit-source-card').count(), 0, 'an empty library must not show a stale editor or source card');
            assert.equal(await page.locator('.edit-page-navigation button').last().isDisabled(), true, 'model progression is disabled until a source exists');
            assert.equal(await page.locator('.edit-empty button').isEnabled(), true, 'the empty state offers a working extraction route');
            await inspectLayout('.marking-edit-page .edit-empty');
            const action = await page.locator('.edit-page-heading .edit-page-navigation').boundingBox();
            assert(action.x >= 0 && action.x + action.width <= size.width + 1, 'localized marking navigation must fit the window');
            await page.locator('.edit-empty button').click();
            await page.locator('.workspace.page-references:visible').waitFor();
            await settleWorkflowNavigation(page, 'references');
            await stage('marking-edit');
          }
          if (key === 'assembly') assert.equal(await page.locator('.assembly-empty:visible').count(), 1, 'a model without cut bindings stays in the real assembly empty state');
          if (key === 'pattern') {
            const tabs = page.locator('.pattern-subtabs [role="tab"]');
            assert.equal(await tabs.count(), 5);
            assert.equal(await tabs.first().getAttribute('aria-selected'), 'true', 'pattern making opens in its default pieces tab');
            for (let index = 0; index < 5; index++) {
              await tabs.nth(index).click();
              assert.equal(await tabs.nth(index).getAttribute('aria-selected'), 'true');
              assert.equal(await page.locator('.pattern-subtabs [role="tab"].active').count(), 1);
              assert.equal(await page.locator('.pattern-subtabs [aria-selected="true"]').count(), 1);
            }
            await tabs.first().click();
          }
          const isModel = ['model', 'mapping', 'cutting'].includes(key);
          assert.equal(await page.locator('[aria-label="3D model preview"]:visible').count(), isModel ? 1 : 0);
          if (isModel) {
            assert.equal(await page.locator('.surface-panel').count(), 1, 'only one persistent surface panel may exist');
            const sameInstance = await page.evaluate(() => {
              const preview = document.querySelector('[aria-label="3D model preview"]');
              window.__appleSharedPreview ??= preview;
              return window.__appleSharedPreview === preview;
            });
            assert(sameInstance, 'the same model preview DOM instance must move between model stages');
            const preview = await page.locator('[aria-label="3D model preview"]:visible').boundingBox();
            assert(preview.height >= 160 && preview.width >= 180, 'shared model preview must retain usable visible dimensions');
            if (locale === 'zh' && key === 'model') await assertSurfaceRendered(page, 2);
          }
          return bounds;
        });
      }

      await page.locator('.activity-toggle').click();
      await page.locator('.activity-panel:visible').waitFor();
      await check(`${prefix}-activity`, async () => {
        const panel = page.locator('.activity-panel');
        const tabs = panel.locator('.tabs > button');
        assert.equal(await tabs.count(), 4);
        for (let index = 0; index < 4; index++) {
          await tabs.nth(index).click();
          assert(await tabs.nth(index).evaluate(element => element.classList.contains('active')));
          assert.equal(await panel.locator('.tabs > button.active').count(), 1, 'activity has exactly one active tab');
        }
        const workspace = await inspectLayout('.workspace:visible', 140);
        const panelBounds = await panel.boundingBox();
        assert(panelBounds.height >= 80 && panelBounds.y + panelBounds.height <= size.height, 'activity drawer remains inside the visible window');
        return {workspace, panelBounds};
      });
      await page.locator('.activity-close').click();
      assert.equal(await page.locator('.activity-toggle').getAttribute('aria-expanded'), 'false');

      const assistantButton = page.locator('.project-toolbar > button[aria-pressed]');
      await assistantButton.click();
      await page.locator('.assistant-page:visible').waitFor();
      for (let index = 0; index < 4; index++) {
        await page.locator('.assistant-page [role="tab"]').nth(index).click();
        await check(`${prefix}-assistant-${['models', 'skills', 'mcp', 'connection'][index]}`, async () => {
          assert.equal(await assistantButton.getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('.assistant-page [role="tab"][aria-selected="true"]').count(), 1);
          assert.equal(await page.locator('.assistant-page [role="tab"]').nth(index).getAttribute('aria-selected'), 'true');
          assert.equal(await page.locator('.assistant-page [role="tab"].active').count(), 1);
          assert.equal(await page.locator('.workspace:visible').count(), 0);
          return inspectLayout('.assistant-page:visible');
        });
      }
      await assistantButton.click();
      await page.locator('.workspace:visible').waitFor();
    }
  }

  await page.setViewportSize(sizes[0]);
  await selectLanguage('zh');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await stage('model');
  await check('reduced-motion-model', async () => {
    const motion = await page.evaluate(() => {
      const visible = element => element.getClientRects().length > 0;
      const seconds = value => value.split(',').map(part => parseFloat(part.trim()) || 0);
      const moving = [...document.querySelectorAll('.app-shell *')].filter(visible).flatMap(element => {
        const style = getComputedStyle(element);
        return [...seconds(style.transitionDuration), ...seconds(style.animationDuration)].some(value => value > .001)
          ? [{tag: element.tagName, className: element.getAttribute('class'), transition: style.transitionDuration, animation: style.animationDuration}] : [];
      });
      return {reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, moving};
    });
    assert(motion.reduced, 'reduced motion media preference must be active');
    assert.deepEqual(motion.moving, [], 'visible UI suppresses animation and transitions when reduced motion is requested');
    await assertSurfaceRendered(page, 2);
    return motion;
  });
  await page.emulateMedia({reducedMotion: 'no-preference'});

  const final = await page.evaluate(() => window.fpcad.read());
  assert(final.ok, JSON.stringify(final));
  assert.equal(final.data.project.revision, initialRevision, 'navigation, assistant tab selection and activity inspection must not mutate the CAD document');
  assert.equal(final.data.project.surface.faces.length, 2);
  await hiddenWindowId(app, page);
} catch (error) {
  fatal = error;
  await capture('fatal').catch(() => {});
} finally {
  const failed = checks.filter(check => !check.passed);
  const report = {screenshotPolicy: 'all DOM/business checks; representative zh 1280x800 screenshots and every failure', passed: !fatal && !failed.length && !errors.length, testedBuild, offscreen: process.env.FPCAD_TEST_OFFSCREEN === '1', directory, checks, screenshots, navigationMetrics, captureAttempts, errors, fatal: fatal?.stack};
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await app.close();
  console.log(JSON.stringify({passed: report.passed, checks: checks.length, failures: failed.map(check => check.name), screenshots: screenshots.length, report: resolve(output, 'report.json')}));
  if (fatal) throw fatal;
  assert.deepEqual(errors, [], 'renderer errors and Vue warnings must be absent');
  assert.equal(failed.length, 0, failed.map(check => `${check.name}: ${check.error}`).join('\n'));
}
