import * as vscode from 'vscode';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import Groq from "groq-sdk";
import * as fs from 'fs';

let aiDocument: vscode.TextDocument | undefined;
let originalUri: vscode.Uri | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Load saved model configuration
  currentModel = context.globalState.get('currentModel', 'sonnet');

  context.subscriptions.push(
    vscode.commands.registerCommand('tad.editFileDirectReplace', () => editFile(true)),
    vscode.commands.registerCommand('tad.editFileWithCompare', () => editFile(false)),
    vscode.commands.registerCommand('tad.editSelectionDirectReplace', () => editSelection(true)),
    vscode.commands.registerCommand('tad.editSelectionAppend', () => editSelection(false)),
    vscode.commands.registerCommand('tad.editSelectionWithCompare', () => editSelectionWithCompare()),
    vscode.workspace.onDidSaveTextDocument(handleSave),
    vscode.workspace.onDidCloseTextDocument(handleClose)
  );

  // Register command to change AI model
  context.subscriptions.push(
    vscode.commands.registerCommand('tad.changeAIModel', () => changeAIModel(context))
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
      logPrompt('system', content, response, 'direct');
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
      logPrompt('system', selectedText, response, 'direct');
    } else {
      const newText = selectedText + '\n' + response;
      applyChanges(editor.document.uri, newText, selection);
      logPrompt('system', selectedText, response, 'append');
    }
  }
}

async function editSelectionWithCompare() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const buildContent = await getBuildFileContent();
    const response = await callAI(selectedText, buildContent, editor.document.fileName);

    // Create a new content by replacing the selected text with the AI response
    const originalContent = editor.document.getText();
    const newContent =
      originalContent.substring(0, editor.document.offsetAt(selection.start)) +
      response +
      originalContent.substring(editor.document.offsetAt(selection.end));

    await showDiff(editor.document.uri, newContent, selection);
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
  const systemPrompt = `<Project>${buildContent}</Project>
Here's a file within that project which has "AI" annotations where some action needs to take place. Please take action and generate the next version of this file. Respond with full code only.
Absolutely do not ever wrap the code in any backticks. Remove any "AI" annotations from the output that have been addressed.
<FileName>${path.basename(filePath)}</FileName>

Example
  Input:
    <Project>Hello</Project>
    <Filename>main.py</Filename>
    # AI: Write hello world
  Output:
    print("Hello, World!")`;

  const userPrompt = content;

  const response = await callAIAPI(systemPrompt, userPrompt);
  return response;
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
      const originalDocument = await vscode.workspace.openTextDocument(originalUri);
      const originalLastLine = originalDocument.lineAt(originalDocument.lineCount - 1);

      edit.replace(
        originalUri,
        new vscode.Range(0, 0, originalDocument.lineCount - 1, originalLastLine.text.length),
        document.getText()
      );
      await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage("AI-generated changes applied successfully.");

      // Log the applied changes
      logPrompt('system', originalDocument.getText(), document.getText(), 'compare');

      // Close the AI document
      await deleteAIDocument();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
    }
  }
}

async function handleClose(document: vscode.TextDocument) {
  if (aiDocument && document.uri.toString() === aiDocument.uri.toString()) {
    // Log the discarded changes
    const originalDocument = await vscode.workspace.openTextDocument(originalUri!);
    logPrompt('system', originalDocument.getText(), aiDocument.getText(), 'discarded');

    // Delete the AI document
    await deleteAIDocument();
  }
}

async function deleteAIDocument() {
  if (aiDocument) {
    const uri = aiDocument.uri;
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
    aiDocument = undefined;
    originalUri = undefined;
  }
}

// AI model configuration
let currentModel: string;

async function changeAIModel(context: vscode.ExtensionContext) {
  const models = ["sonnet", "llama3"];
  const selectedModel = await vscode.window.showQuickPick(models, {
    placeHolder: "Select AI model",
  });

  if (selectedModel) {
    currentModel = selectedModel;
    // Save the selected model
    await context.globalState.update('currentModel', currentModel);
    vscode.window.showInformationMessage(`AI model changed to ${currentModel}`);
  }
}

async function callAIAPI(systemPrompt: string, userPrompt: string): Promise<string> {
  console.log(`Model used: ${currentModel}`);
  if (currentModel === "sonnet") {
    return await callClaudeAPI(systemPrompt, userPrompt);
  } else if (currentModel === "llama3") {
    return await callGrokLlamaAPI(systemPrompt, userPrompt);
  } else {
    throw new Error("Unsupported AI model");
  }
}

const anthropic = new Anthropic({});
async function callClaudeAPI(systemPrompt: string, userPrompt: string): Promise<string> {
  console.log(systemPrompt, userPrompt);

  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 4*1024,
    system: systemPrompt,
    messages: [{role: "user", content: userPrompt }],
  });
  return (msg.content[0] as Anthropic.TextBlock).text;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
async function callGrokLlamaAPI(systemPrompt: string, userPrompt: string): Promise<string> {
  const msg = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    model: "llama-3.1-70b-versatile",
    max_tokens: 8*1000-1,
  });
  console.log("Calling Grok Llama 3 API with request:", systemPrompt, userPrompt);
  return msg.choices[0]?.message?.content || "";
}

function logPrompt(systemPrompt: string, userPrompt: string, response: string, applicationType: 'direct' | 'compare' | 'append' | 'discarded') {
  const config = vscode.workspace.getConfiguration('tad');
  const logFilePath = config.get<string>('logFilePath');

  if (logFilePath) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      model: currentModel,
      systemPrompt,
      userPrompt,
      response,
      applicationType
    };

    fs.appendFile(logFilePath, JSON.stringify(logEntry) + '\n', (err) => {
      if (err) {
        console.error('Error writing to log file:', err);
      }
    });
  }
}

export function deactivate() {}