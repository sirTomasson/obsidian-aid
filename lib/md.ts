import {MarkdownRenderer, Plugin} from 'obsidian';

export class MarkdownRenderingContext {

  constructor(protected plugin: Plugin) {}

  static async renderMarkdown(context: MarkdownRenderingContext,
                                       text: string,
                                       element: HTMLElement) {
    await MarkdownRenderer.render(context.plugin.app, text, element, '', context.plugin);
  }
}

