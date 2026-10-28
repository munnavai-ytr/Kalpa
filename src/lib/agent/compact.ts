import { ActionStream, type Action } from './actions';

function summarizeAction(action: Exclude<Action, { type: 'text' }>): string {
  switch (action.type) {
    case 'file': {
      const lineCount = action.content ? action.content.split('\n').length : 0;
      return `[wrote ${action.path} - ${lineCount} lines]`;
    }
    case 'edit':
      return `[edited ${action.path} - ${action.edits.length} change${action.edits.length === 1 ? '' : 's'}]`;
    case 'delete':
      return `[deleted ${action.path}]`;
    case 'move':
      return `[moved ${action.from} -> ${action.to}]`;
    case 'read':
      return `[read ${action.path}${action.lines ? ` (${action.lines})` : ''}]`;
    case 'search':
      return `[searched "${action.query}"]`;
    case 'list':
      return `[listed ${action.path}]`;
    case 'impact':
      return `[checked impact: ${action.target || action.symbol || ''}]`;
    case 'shell':
      return `[ran: ${action.cmd.replace(/\s+/g, ' ').slice(0, 72)}]`;
    case 'memory':
      return `[memory ${action.op} ${action.file}.md]`;
    case 'question':
      return `[asked: ${action.text}]`;
    case 'status':
      return '';
    case 'complete':
      return `[completed milestone ${action.milestone || ''}${action.next ? ` -> next ${action.next}` : ''}]`;
    case 'finished':
      return '[finished]';
  }
}

/**
 * Re-parses an older assistant message with ActionStream and replaces verbose
 * action blocks with compact single-line summaries while preserving plain text.
 */
export function compactAssistantMessage(rawContent: string): string {
  if (!rawContent) return '';
  const stream = new ActionStream();
  const segments: string[] = [];

  const handleActions = (actions: Action[]) => {
    for (const a of actions) {
      if (a.type === 'text') {
        if (a.text.trim()) segments.push(a.text.trim());
      } else {
        const line = summarizeAction(a);
        if (line) segments.push(line);
      }
    }
  };

  handleActions(stream.push(rawContent));
  handleActions(stream.end().actions);

  return segments.join('\n');
}

/**
 * Compacts older synthetic <result ...> user messages so raw file dumps do not bloat history.
 */
export function compactResultUserMessage(rawContent: string): string {
  if (!rawContent.includes('<result ')) return rawContent;
  return rawContent.replace(
    /<result\s+([^>]*)>[\s\S]*?<\/result>/g,
    (_m, attrs: string) => `[tool result: ${attrs.trim()}]`
  );
}
