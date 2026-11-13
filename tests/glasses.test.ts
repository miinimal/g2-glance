import { describe, expect, it } from 'vitest';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { EvenHubGlasses, startupContainers } from '../src/bridge/glasses';
import { LAYOUT } from '../src/core/render';

const view = { header: 'H', body: 'B', footer: 'F' };

class FakeBridge {
  calls: [string, unknown][] = [];
  createResult = 0;
  rebuildResult = true;
  async createStartUpPageContainer(c: unknown) {
    this.calls.push(['create', c]);
    return this.createResult;
  }
  async rebuildPageContainer(c: unknown) {
    this.calls.push(['rebuild', c]);
    return this.rebuildResult;
  }
  async textContainerUpgrade(c: unknown) {
    this.calls.push(['upgrade', c]);
    return true;
  }
  async audioControl(on: boolean, source?: unknown) {
    this.calls.push(['audio', [on, source]]);
    return true;
  }
  async shutDownPageContainer(mode: number) {
    this.calls.push(['exit', mode]);
    return true;
  }
}

function setup() {
  const fake = new FakeBridge();
  return { fake, glasses: new EvenHubGlasses(fake as unknown as EvenAppBridge) };
}

describe('startupContainers', () => {
  const containers = startupContainers({ header: 'H', body: '', footer: 'F' });

  it('follows the Even Hub page rules', () => {
    expect(containers).toHaveLength(3);
    expect(containers.filter((c) => c.isEventCapture === 1)).toHaveLength(1);
    expect(containers.find((c) => c.isEventCapture === 1)?.containerName).toBe('glance-body');
    expect(new Set(containers.map((c) => c.containerID)).size).toBe(3);
    expect(new Set(containers.map((c) => c.containerName)).size).toBe(3);
    for (const c of containers) {
      expect(c.containerName!.length).toBeLessThanOrEqual(16);
      expect(c.textColor).toBeGreaterThanOrEqual(0);
      expect(c.textColor).toBeLessThanOrEqual(4);
      expect(c.zOrderIndex).toBeUndefined(); // all-or-none: we use none
      expect(c.paddingLength).toBeLessThanOrEqual(32);
      expect(c.borderWidth).toBeLessThanOrEqual(5);
    }
  });

  it('uses the shared layout', () => {
    expect(containers[1]).toMatchObject({
      xPosition: LAYOUT.body.x,
      yPosition: LAYOUT.body.y,
      width: LAYOUT.body.width,
      height: LAYOUT.body.height,
    });
  });

  it('never sends an empty content string', () => {
    expect(containers[1]!.content).toBe(' ');
  });
});

describe('EvenHubGlasses', () => {
  it('creates the page once, then upgrades only changed containers', async () => {
    const { fake, glasses } = setup();
    await glasses.show(view);
    await glasses.show({ ...view, body: 'B2' });
    await glasses.show({ ...view, body: 'B2' });
    expect(fake.calls.map(([k]) => k)).toEqual(['create', 'upgrade']);
    expect(fake.calls[1]![1]).toMatchObject({ containerID: 2, containerName: 'glance-body', content: 'B2' });
  });

  it('rebuilds when the start-up page already exists (WebView reload)', async () => {
    const { fake, glasses } = setup();
    fake.createResult = 1;
    await glasses.show(view);
    expect(fake.calls.map(([k]) => k)).toEqual(['create', 'rebuild']);
  });

  it('throws when the page cannot be created at all', async () => {
    const { fake, glasses } = setup();
    fake.createResult = 2;
    fake.rebuildResult = false;
    await expect(glasses.show(view)).rejects.toThrow(/code 2/);
  });

  it('opens the glasses microphone only after the page exists', async () => {
    const { fake, glasses } = setup();
    expect(await glasses.setMic(true)).toBe(false);
    await glasses.show(view);
    expect(await glasses.setMic(true)).toBe(true);
    await glasses.setMic(false);
    expect(fake.calls.filter(([k]) => k === 'audio').map(([, v]) => v)).toEqual([
      [true, 'glasses'],
      [false, undefined],
    ]);
  });

  it('exits with the system dialog (mode 1), as Even Hub review requires', async () => {
    const { fake, glasses } = setup();
    await glasses.exit();
    expect(fake.calls).toEqual([['exit', 1]]);
  });
});
