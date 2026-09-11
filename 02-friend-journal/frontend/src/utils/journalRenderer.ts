import { fabric } from 'fabric';
import type { Journal, JournalLayout } from '@/types';

const JOURNAL_WIDTH = 800;
const JOURNAL_HEIGHT = 1200;

interface RenderOptions {
  format: 'png' | 'pdf';
  quality?: number;
}

export class JournalRenderer {
  private canvas: fabric.Canvas | null = null;

  constructor(canvasElement: HTMLCanvasElement) {
    this.canvas = new fabric.Canvas(canvasElement, {
      width: JOURNAL_WIDTH,
      height: JOURNAL_HEIGHT,
      backgroundColor: '#ffffff',
    });
  }

  /**
   * 渲染手账
   */
  async render(journal: Journal, layout: JournalLayout): Promise<void> {
    if (!this.canvas) throw new Error('Canvas not initialized');

    // 清除画布
    this.canvas.clear();
    this.canvas.setBackgroundColor('#ffffff', this.canvas.renderAll.bind(this.canvas));

    // 应用背景颜色
    const bgColor = layout.colors[0] || '#ffffff';
    this.canvas.setBackgroundColor(bgColor, this.canvas.renderAll.bind(this.canvas));

    // 渲染标题
    this.renderTitle(journal.content.title, layout);

    // 渲染正文
    this.renderText(journal.content.text, layout);

    // 渲染事件列表
    if (journal.content.events.length > 0) {
      this.renderEvents(journal.content.events, layout);
    }

    // 渲染图片
    if (journal.images.length > 0) {
      await this.renderImages(journal.images, layout);
    }

    // 渲染装饰元素
    this.renderDecorations(layout.decorations);

    // 渲染情绪标签
    if (journal.content.emotions.length > 0) {
      this.renderEmotions(journal.content.emotions, layout);
    }
  }

  /**
   * 渲染标题
   */
  private renderTitle(title: string, layout: JournalLayout): void {
    if (!this.canvas) return;

    const titleText = new fabric.Text(title, {
      left: JOURNAL_WIDTH / 2,
      top: 60,
      fontSize: 36,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold',
      fill: layout.colors[1] || '#333333',
      textAlign: 'center',
      originX: 'center',
      originY: 'top',
    });

    this.canvas.add(titleText);
  }

  /**
   * 渲染正文
   */
  private renderText(text: string, layout: JournalLayout): void {
    if (!this.canvas) return;

    // 将长文本分行
    const maxWidth = JOURNAL_WIDTH - 120;
    const textLines = this.wrapText(text, maxWidth, 18);

    textLines.forEach((line, index) => {
      const textObj = new fabric.Text(line, {
        left: 60,
        top: 180 + index * 28,
        fontSize: 18,
        fontFamily: 'Arial, sans-serif',
        fill: '#555555',
        lineHeight: 1.5,
      });
      this.canvas!.add(textObj);
    });
  }

  /**
   * 渲染事件列表
   */
  private renderEvents(events: string[], layout: JournalLayout): void {
    if (!this.canvas) return;

    const startY = 500;
    const bulletColor = layout.colors[2] || '#FFB6C1';

    events.forEach((event, index) => {
      const y = startY + index * 50;

      // 项目符号
      const bullet = new fabric.Circle({
        left: 80,
        top: y,
        radius: 6,
        fill: bulletColor,
        originX: 'center',
        originY: 'center',
      });
      this.canvas!.add(bullet);

      // 事件文本
      const eventText = new fabric.Text(event, {
        left: 110,
        top: y,
        fontSize: 16,
        fontFamily: 'Arial, sans-serif',
        fill: '#666666',
        originY: 'center',
      });
      this.canvas!.add(eventText);
    });
  }

  /**
   * 渲染图片
   */
  private async renderImages(imageUrls: string[], layout: JournalLayout): Promise<void> {
    if (!this.canvas) return;

    const startY = 800;
    const imageSize = 150;
    const spacing = 20;
    const imagesPerRow = Math.floor((JOURNAL_WIDTH - 120) / (imageSize + spacing));

    for (let i = 0; i < Math.min(imageUrls.length, 4); i++) {
      const row = Math.floor(i / imagesPerRow);
      const col = i % imagesPerRow;
      const x = 60 + col * (imageSize + spacing);
      const y = startY + row * (imageSize + spacing);

      try {
        await new Promise<void>((resolve, reject) => {
          fabric.Image.fromURL(imageUrls[i], (img) => {
            img.scaleToWidth(imageSize);
            img.set({
              left: x,
              top: y,
            });
            this.canvas!.add(img);
            resolve();
          });
        });
      } catch (error) {
        console.error(`Failed to load image ${imageUrls[i]}:`, error);
      }
    }
  }

  /**
   * 渲染装饰元素
   */
  private renderDecorations(decorations: JournalLayout['decorations']): void {
    if (!this.canvas || decorations.length === 0) return;

    decorations.forEach((decoration) => {
      if (decoration.type === 'sticker') {
        // 简单的装饰圆圈
        const circle = new fabric.Circle({
          left: decoration.position.x,
          top: decoration.position.y,
          radius: 30,
          fill: decoration.data || '#FFE4E1',
          opacity: 0.6,
        });
        this.canvas!.add(circle);
      } else if (decoration.type === 'border') {
        // 边框装饰
        const rect = new fabric.Rect({
          left: decoration.position.x,
          top: decoration.position.y,
          width: 100,
          height: 100,
          fill: 'transparent',
          stroke: decoration.data || '#FFB6C1',
          strokeWidth: 2,
        });
        this.canvas!.add(rect);
      }
    });
  }

  /**
   * 渲染情绪标签
   */
  private renderEmotions(emotions: string[], layout: JournalLayout): void {
    if (!this.canvas) return;

    const startX = JOURNAL_WIDTH - 200;
    const startY = 1000;
    const tagColor = layout.colors[1] || '#FFB6C1';

    emotions.forEach((emotion, index) => {
      const tag = new fabric.Rect({
        left: startX,
        top: startY + index * 40,
        width: 80,
        height: 30,
        fill: tagColor,
        rx: 15,
        ry: 15,
        opacity: 0.8,
      });
      this.canvas!.add(tag);

      const emotionText = new fabric.Text(emotion, {
        left: startX + 40,
        top: startY + index * 40 + 15,
        fontSize: 14,
        fontFamily: 'Arial, sans-serif',
        fill: '#ffffff',
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
      });
      this.canvas!.add(emotionText);
    });
  }

  /**
   * 文本换行
   */
  private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    const words = text.split('');
    const lines: string[] = [];
    let currentLine = '';

    // 简单的字符数估算（中文字符按2个英文字符宽度计算）
    const charWidth = fontSize * 0.6;
    const maxCharsPerLine = Math.floor(maxWidth / charWidth);

    for (const char of words) {
      const testLine = currentLine + char;
      const isChinese = /[\u4e00-\u9fa5]/.test(char);
      const charCount = currentLine.split('').reduce((count, c) => {
        return count + (/[\u4e00-\u9fa5]/.test(c) ? 2 : 1);
      }, 0) + (isChinese ? 2 : 1);

      if (charCount > maxCharsPerLine && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * 导出为图片
   */
  async exportAsImage(options: RenderOptions = { format: 'png' }): Promise<string> {
    if (!this.canvas) throw new Error('Canvas not initialized');

    const quality = options.quality || 1;
    return this.canvas.toDataURL({
      format: options.format,
      quality,
      multiplier: 2, // 提高分辨率
    });
  }

  /**
   * 导出为PDF（需要jsPDF库）
   */
  async exportAsPDF(): Promise<Blob> {
    if (!this.canvas) throw new Error('Canvas not initialized');

    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'px',
      format: [JOURNAL_WIDTH, JOURNAL_HEIGHT],
    });

    const imgData = await this.exportAsImage({ format: 'png', quality: 1 });
    pdf.addImage(imgData, 'PNG', 0, 0, JOURNAL_WIDTH, JOURNAL_HEIGHT);
    
    return pdf.output('blob');
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
  }
}



