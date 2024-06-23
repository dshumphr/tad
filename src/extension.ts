import * as vscode from 'vscode';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

let aiDocument: vscode.TextDocument | undefined;
let originalUri: vscode.Uri | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('tad.editFileDirectReplace', () => editFile(true)),
    vscode.commands.registerCommand('tad.editFileWithCompare', () => editFile(false)),
    vscode.commands.registerCommand('tad.editSelectionDirectReplace', () => editSelection(true)),
    vscode.commands.registerCommand('tad.editSelectionAppend', () => editSelection(false)),
    vscode.workspace.onDidSaveTextDocument(handleSave)
  );
}

async function editFile(directReplace: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const document = editor.document;
    const content = document.getText();
    const buildContent = await getBuildFileContent();
    const response = await callAI(content, buildContent, document.fileName);
    if (directReplace) {
      applyChanges(document.uri, response, null);
    } else {
      await showDiff(document.uri, response);
    }
  }
}

async function editSelection(directReplace: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const buildContent = await getBuildFileContent();
    const response = await callAI(selectedText, buildContent, editor.document.fileName);
    if (directReplace) {
      applyChanges(editor.document.uri, response, selection);
    } else {
      const newText = selectedText + '\n' + response;
      applyChanges(editor.document.uri, newText, selection);
    }
  }
}

async function getBuildFileContent(): Promise<string> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const buildFilePath = path.join(rootPath, 'AI.md');
    try {
      const buildFileUri = vscode.Uri.file(buildFilePath);
      const buildFileContent = await vscode.workspace.fs.readFile(buildFileUri);
      return Buffer.from(buildFileContent).toString('utf8');
    } catch (error) {
      console.error('Error reading AI.md:', error);
      return '';
    }
  }
  return '';
}

async function callAI(content: string, buildContent: string, filePath: string): Promise<string> {
  const xmlRequest = `
    <Project>${buildContent}</Project>
    Here's a file within that project which has "AI" annotations where some action needs to take place. Please take action and generate the next version of this file. Respond with code only.
    <FileName>${path.basename(filePath)}</FileName>
    <FileContent>${content}</FileContent>
  `;

  return await callClaudeAPI(xmlRequest);
}

async function showDiff(fileUri: vscode.Uri, aiResponse: string, selection: vscode.Selection | null = null) {
  originalUri = fileUri;
  const newFilePath = `${fileUri.fsPath}.ai`;
  const uri = vscode.Uri.file(newFilePath);

  await vscode.workspace.fs.writeFile(uri, Buffer.from('', 'utf8'));
  await vscode.commands.executeCommand('vscode.diff', fileUri, uri, 'Original ↔ AI-generated (Editable)');
  const editor = vscode.window.visibleTextEditors.find(editor => 
    editor.document.uri.toString() === uri.toString()
  );

  if (editor) {
      vscode.window.showInformationMessage('Right side editor found');

      // Apply an edit to insert text in the right side editor
      await editor.edit(editBuilder => {
          editBuilder.insert(new vscode.Position(0, 0), aiResponse);
      });
  }
  aiDocument = await vscode.workspace.openTextDocument(uri);

  // Show info message
  vscode.window.showInformationMessage("Review AI changes. Save the right-side document to apply changes.");
}

function applyChanges(fileUri: vscode.Uri, aiResponse: string, selection: vscode.Selection | null) {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.toString() === fileUri.toString()) {
    editor.edit(editBuilder => {
      if (selection) {
        editBuilder.replace(selection, aiResponse);
      } else {
        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(editor.document.getText().length)
        );
        editBuilder.replace(fullRange, aiResponse);
      }
    });
  }
}

async function handleSave(document: vscode.TextDocument) {
  if (aiDocument && document.uri.toString() === aiDocument.uri.toString() && originalUri) {
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        originalUri,
        new vscode.Range(0, 0, document.lineCount, 0),
        document.getText()
      );
      await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage("AI-generated changes applied successfully.");
      
      // Close the AI document
      const uri = aiDocument.uri;
      async function deleteAIDocument() {
        try {
          // Close any open editors with the AI-generated document
          const aiEditors = vscode.window.visibleTextEditors.filter(editor => editor.document.uri.toString() === uri.toString());
          for (const editor of aiEditors) {
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor', editor);
          }
    
          // Delete the AI-generated document
          await vscode.workspace.fs.delete(uri);
        } catch (error) {
          console.error('Error deleting AI-generated document:', error);
        }
      }
    
      // Execute the delete function when needed
      await deleteAIDocument();
      aiDocument = undefined;
      originalUri = undefined;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
    }
  }
}

async function callClaudeAPI(req: string): Promise<string> {
  const anthropic = new Anthropic({});
  console.log(req);

  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 4*1024,
    messages: [{ role: "user", content: req }],
  });
  return (msg.content[0] as Anthropic.TextBlock).text;
}

export function deactivate() {}