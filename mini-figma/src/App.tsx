import { useState } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import PropertiesPanel from './components/PropertiesPanel'
import LayersPanel from './components/LayersPanel'
import { DEFAULT_TOOL } from './constants/tools'
import { useHotkeys } from './hooks/useHotkeys'
import { useShapes } from './hooks/useShapes'
import type { Tool } from './types/shape'

/**
 * Собирает холст и три панели.
 *
 * tool — активный инструмент, shapes/selectedId — данные из useShapes.
 * useHotkeys подключает клавиатуру: V/R/O переключают инструменты,
 * Delete удаляет, Escape снимает выделение, Ctrl+Z / Ctrl+Shift+Z — история.
 */
export default function App() {
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL)
  const {
    shapes,
    selectedId,
    selectedShape,
    selectShape,
    updateShape,
    removeShape,
    draftShape,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDragging,
    startDragging,
    updateDragging,
    finishDragging,
    cancelDragging,
    undo,
    redo,
  } = useShapes()

  useHotkeys({
    onSelectTool: setTool,
    onDeselect: () => {
      // Escape: прерываем текущий жест и снимаем выделение.
      cancelDrawing()
      cancelDragging()
      selectShape(null)
    },
    onDeleteSelected: () => {
      if (selectedId) {
        removeShape(selectedId)
      }
    },
    onUndo: undo,
    onRedo: redo,
  })

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-neutral-100 text-neutral-900">
      <Toolbar activeTool={tool} onSelectTool={setTool} />

      <main className="relative min-w-0 flex-1">
        <Canvas
          shapes={shapes}
          tool={tool}
          selectedId={selectedId}
          isDragging={isDragging}
          draftShape={draftShape}
          onDrawStart={startDrawing}
          onDrawMove={updateDrawing}
          onDrawEnd={finishDrawing}
          onDrawCancel={cancelDrawing}
          onSelectShape={selectShape}
          onDragStart={startDragging}
          onDragMove={updateDragging}
          onDragEnd={finishDragging}
          onDragCancel={cancelDragging}
        />
      </main>

      <aside className="z-10 flex w-64 shrink-0 flex-col border-l border-neutral-200 bg-white">
        <LayersPanel shapes={shapes} selectedId={selectedId} onSelectShape={selectShape} />
        <PropertiesPanel shape={selectedShape} onChange={updateShape} />
      </aside>
    </div>
  )
}
