import fs from 'node:fs/promises';
import {MarkdownRenderingContext} from './md';

export class MarkdownFilePreviewView {
  private containerEl: HTMLElement | null = null;

  constructor(private readonly rootEl: HTMLElement,
              private readonly targetEl: HTMLElement,
              private readonly filename: string,
              private readonly markdownContext: MarkdownRenderingContext,
              private readonly onHide: () => void) {
  }

  public show() {
    this.containerEl = this.rootEl.createDiv({ cls: 'popover hover-popover'});

    const contentEl = this.containerEl
      .createDiv({ cls: 'markdown-embed' })
      .createDiv({ cls: 'markdown-embed-content' })
      .createDiv({ cls: 'markdown-preview-view' });

    this.containerEl.addEventListener('mouseleave', () => {
      this.onHide();
    });

    this.renderMarkdown(contentEl);

    const rootRect = this.rootEl.getBoundingClientRect();
    const elementRect = this.targetEl.getBoundingClientRect();
    const relativeTop = elementRect.bottom - rootRect.top + 16;
    const relativeLeft = elementRect.left - rootRect.left;
    this.containerEl.style.top = `${relativeTop}px`;
    this.containerEl.style.left = `${relativeLeft}px`;
  }

  public hide() {
    if (!this.containerEl) return;
    this.containerEl.remove();
  }

  private async renderMarkdown(containerEL: HTMLElement) {
    const markdownContent = await fs.readFile(this.filename, 'utf8');
    await MarkdownRenderingContext.renderMarkdown(this.markdownContext, markdownContent, containerEL);
  }
}