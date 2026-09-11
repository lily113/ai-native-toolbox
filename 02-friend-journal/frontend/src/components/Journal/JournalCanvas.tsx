import { useEffect, useRef, useState } from 'react';
import { JournalRenderer } from '@/utils/journalRenderer';
import ShareModal from './ShareModal';
import type { Journal, JournalLayout } from '@/types';

interface JournalCanvasProps {
  journal: Journal;
  layout: JournalLayout;
  onExport?: (format: 'png' | 'pdf') => void;
}

export default function JournalCanvas({ journal, layout, onExport }: JournalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<JournalRenderer | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
      rendererRef.current = new JournalRenderer(canvasRef.current);
    }

    const render = async () => {
      if (rendererRef.current) {
        setIsRendering(true);
        try {
          await rendererRef.current.render(journal, layout);
        } catch (error) {
          console.error('Failed to render journal:', error);
        } finally {
          setIsRendering(false);
        }
      }
    };

    render();

    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [journal, layout]);

  const handleExportPNG = async () => {
    if (rendererRef.current) {
      try {
        const dataUrl = await rendererRef.current.exportAsImage({ format: 'png' });
        const link = document.createElement('a');
        link.download = `journal-${journal.id}.png`;
        link.href = dataUrl;
        link.click();
        onExport?.('png');
      } catch (error) {
        console.error('Failed to export PNG:', error);
        alert('导出失败，请重试');
      }
    }
  };

  const handleExportPDF = async () => {
    if (rendererRef.current) {
      try {
        const blob = await rendererRef.current.exportAsPDF();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `journal-${journal.id}.pdf`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        onExport?.('pdf');
      } catch (error) {
        console.error('Failed to export PDF:', error);
        alert('导出失败，请重试');
      }
    }
  };

  const [showShareModal, setShowShareModal] = useState(false);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">手账预览</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowShareModal(true)}
            disabled={isRendering}
            className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 disabled:opacity-50"
          >
            分享
          </button>
          <button
            onClick={handleExportPNG}
            disabled={isRendering}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            导出PNG
          </button>
          <button
            onClick={handleExportPDF}
            disabled={isRendering}
            className="bg-pink-500 text-white px-4 py-2 rounded-lg hover:bg-pink-600 disabled:opacity-50"
          >
            导出PDF
          </button>
        </div>
      </div>
      {showShareModal && (
        <ShareModal
          journal={journal}
          onClose={() => setShowShareModal(false)}
          onShared={(shareJournal) => {
            console.log('Shared journal:', shareJournal);
            // 可以在这里处理分享后的逻辑，比如跳转到分享版手账
          }}
        />
      )}
      {isRendering && (
        <div className="text-center text-gray-500 mb-4">渲染中...</div>
      )}
      <div className="border-2 border-gray-200 rounded-lg p-4 bg-gray-50 overflow-auto">
        <canvas ref={canvasRef} className="mx-auto shadow-lg" />
      </div>
    </div>
  );
}

