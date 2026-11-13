/**
 * Even Hub bridge adapter: the only file that talks to the glasses.
 */
import {
  AudioInputSource,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type { GlassesPort } from '../app/controller';
import { LAYOUT, type View } from '../core/render';

type Slot = keyof View;

const CONTAINERS: Record<Slot, { id: number; name: string; textColor: number }> = {
  header: { id: 1, name: 'glance-hdr', textColor: 3 },
  body: { id: 2, name: 'glance-body', textColor: 4 },
  footer: { id: 3, name: 'glance-foot', textColor: 2 },
};

const SLOTS: Slot[] = ['header', 'body', 'footer'];

/** Build the start-up page: three stacked text containers, the body captures input. */
export function startupContainers(view: View): TextContainerProperty[] {
  return SLOTS.map((slot) => {
    const box = LAYOUT[slot];
    const c = CONTAINERS[slot];
    return new TextContainerProperty({
      xPosition: box.x,
      yPosition: box.y,
      width: box.width,
      height: box.height,
      paddingLength: box.padding,
      borderWidth: box.border,
      borderColor: box.border > 0 ? 6 : 0,
      borderRadius: box.border > 0 ? 6 : 0,
      containerID: c.id,
      containerName: c.name,
      isEventCapture: slot === 'body' ? 1 : 0,
      content: view[slot] === '' ? ' ' : view[slot],
      textColor: c.textColor,
    });
  });
}

export class EvenHubGlasses implements GlassesPort {
  private shown: View | null = null;

  constructor(private readonly bridge: EvenAppBridge) {}

  async show(view: View): Promise<void> {
    if (!this.shown) {
      const result = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: SLOTS.length,
          textObject: startupContainers(view),
        }),
      );
      if (result !== StartUpPageCreateResult.success) {
        // After a WebView reload the start-up page already exists and create returns `invalid`
        // (everything-evenhub issue #32). Rebuilding the same page recovers the display.
        const rebuilt = await this.bridge.rebuildPageContainer(
          new RebuildPageContainer({
            containerTotalNum: SLOTS.length,
            textObject: startupContainers(view),
          }),
        );
        if (!rebuilt) throw new Error(`createStartUpPageContainer failed with code ${String(result)}`);
      }
      this.shown = view;
      return;
    }
    for (const slot of SLOTS) {
      if (this.shown[slot] === view[slot]) continue;
      const c = CONTAINERS[slot];
      await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: c.id,
          containerName: c.name,
          content: view[slot] === '' ? ' ' : view[slot],
        }),
      );
    }
    this.shown = view;
  }

  async setMic(on: boolean): Promise<boolean> {
    if (!this.shown) return false; // the glasses mic needs the start-up page first
    return on ? this.bridge.audioControl(true, AudioInputSource.Glasses) : this.bridge.audioControl(false);
  }

  async exit(): Promise<void> {
    // Mode 1 shows the system exit dialog; required for the root page by Even Hub review.
    await this.bridge.shutDownPageContainer(1);
  }
}
