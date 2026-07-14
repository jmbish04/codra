import React, { useEffect, useMemo, useState } from 'react';
import { usePlateEditor, Plate, PlateContent } from '@udecode/plate-common/react';
import { MarkdownPlugin } from '@udecode/plate-markdown';
import { BaseBasicMarksPlugin } from '@udecode/plate-basic-marks';
import { BaseHeadingPlugin } from '@udecode/plate-heading';
import { BaseBlockquotePlugin } from '@udecode/plate-block-quote';
import { BaseCodeBlockPlugin } from '@udecode/plate-code-block';
import { BaseListPlugin } from '@udecode/plate-list';

interface PlateEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function PlateEditor({ value, onChange, placeholder, className, disabled }: PlateEditorProps) {
  // We initialize the editor once. 
  // We'll deserialize the initial value from markdown, and then serialize on changes.
  
  const editor = usePlateEditor({
    plugins: [
      MarkdownPlugin,
      BaseBasicMarksPlugin,
      BaseHeadingPlugin,
      BaseBlockquotePlugin,
      BaseCodeBlockPlugin,
      BaseListPlugin
    ],
    value: []
  });

  const [initialized, setInitialized] = useState(false);

  // Deserialize incoming string on mount
  useEffect(() => {
    if (editor && !initialized && value !== undefined) {
      const ast = editor.getApi(MarkdownPlugin).markdown.deserialize(value || '');
      editor.children = ast.length > 0 ? ast : [{ type: 'p', children: [{ text: '' }] }];
      setInitialized(true);
    }
  }, [editor, value, initialized]);

  // Handle changes and serialize back to markdown
  const handleChange = (e: any) => {
    const isAstChange = editor.operations.some((op) => 'set_selection' !== op.type);
    if (isAstChange) {
      const markdown = editor.getApi(MarkdownPlugin).markdown.serialize();
      onChange(markdown);
    }
  };

  if (!initialized) {
    return <div className="h-40 w-full animate-pulse bg-muted rounded-md border" />;
  }

  return (
    <div className={`rounded-md border border-input bg-background overflow-hidden ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <Plate editor={editor} onValueChange={handleChange}>
        <PlateContent 
          className="min-h-[300px] w-full px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder={placeholder || 'Type here...'}
          readOnly={disabled}
        />
      </Plate>
    </div>
  );
}
