import * as vscode from 'vscode';
import { ArduinoSettingsViewProvider } from './providers/ArduinoSettingsViewProvider';
import { compileSketch, uploadToArduino, uploadHexFile, compileAndUpload } from './utils/arduinoCli';

export function activate(context: vscode.ExtensionContext) {
	// 注册设置视图提供者
	const arduinoSettingsProvider = new ArduinoSettingsViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ArduinoSettingsViewProvider.viewType,
			arduinoSettingsProvider
		)
	);

	// 注册编译命令
	const compileCommand = vscode.commands.registerCommand('arduino-panda.compileArduino', async () => {
		// 优先使用当前活动编辑器中的文件
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && activeEditor.document.uri.fsPath.endsWith('.ino')) {
			const fileToCompile = activeEditor.document.uri;
			await compileFile(fileToCompile);
			return;
		}

		// 如果没有打开的 .ino 文件，则搜索工作区
		const files = await vscode.workspace.findFiles('**/*.ino');
		if (files.length === 0) {
			vscode.window.showErrorMessage('No Arduino files found in workspace');
			return;
		}

		// 如果有多个文件，让用户选择
		let fileToCompile: vscode.Uri;
		if (files.length === 1) {
			fileToCompile = files[0];
		} else {
			const fileItems = files.map(file => ({
				label: vscode.workspace.asRelativePath(file),
				file: file
			}));
			
			const selected = await vscode.window.showQuickPick(fileItems, {
				placeHolder: '选择要编译的 Arduino 文件'
			});
			
			if (!selected) {
				return;
			}
			fileToCompile = selected.file;
		}

		await compileFile(fileToCompile);
	});

	// 抽取编译逻辑到单独的函数
	async function compileFile(file: vscode.Uri) {
		// 获取当前配置的开发板
		const config = vscode.workspace.getConfiguration('arduino-panda');
		const selectedBoard = config.get<string>('board');
		if (!selectedBoard) {
			vscode.window.showErrorMessage('请先选择开发板');
			return;
		}

		// 显示编译进度
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Compiling Arduino code",
			cancellable: false
		}, async (progress) => {
			try {
				progress.report({ message: "Compiling..." });
				await compileSketch(file, selectedBoard);
				vscode.window.showInformationMessage('Compilation successful!');
			} catch (error) {
				vscode.window.showErrorMessage(`Compilation failed: ${error}`);
			}
		});
	}

	// 注册上传命令
	const uploadCommand = vscode.commands.registerCommand('arduino-panda.uploadArduino', async () => {
		// 优先使用当前活动编辑器中的文件
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && activeEditor.document.uri.fsPath.endsWith('.hex')) {
			const fileToUpload = activeEditor.document.uri;
			const config = vscode.workspace.getConfiguration('arduino-panda');
			const selectedBoard = config.get<string>('board');
			const selectedPort = config.get<string>('port');

			if (!selectedBoard || !selectedPort) {
				vscode.window.showErrorMessage('请先选择开发板和串口');
				return;
			}

			// await uploadHexFile(fileToUpload, selectedBoard, selectedPort);
			// 显示上传进度
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Uploading to Arduino",
				cancellable: false
			}, async (progress) => {
				progress.report({ message: "Uploading..." });
				await uploadHexFile(fileToUpload, selectedBoard, selectedPort);
				vscode.window.showInformationMessage('Upload successful!');
			});
			return;
		}

		// 如果没有打开的文件，则搜索 hex 文件
		const hexFiles = await vscode.workspace.findFiles('**/*.hex');
		const allFiles = [...hexFiles];

		if (allFiles.length === 0) {
			vscode.window.showErrorMessage('No Arduino or hex files found in workspace');
			return;
		}

		// 让用户选择要上传的文件
		const fileItems = allFiles.map(file => ({
			label: vscode.workspace.asRelativePath(file),
			file: file,
			description: file.fsPath.endsWith('.hex') ? 'Hex File' : 'Arduino Sketch'
		}));
		
		const selected = await vscode.window.showQuickPick(fileItems, {
			placeHolder: '选择要上传的文件'
		});
		
		if (!selected) {
			return;
		}

		// 获取当前配置
		const config = vscode.workspace.getConfiguration('arduino-panda');
		const selectedBoard = config.get<string>('board');
		const selectedPort = config.get<string>('port');

		if (!selectedBoard) {
			vscode.window.showErrorMessage('请先选择开发板');
			return;
		}
		if (!selectedPort) {
			vscode.window.showErrorMessage('请先选择串口');
			return;
		}

		// 显示上传进度
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Uploading to Arduino",
			cancellable: false
		}, async (progress) => {
			try {
				progress.report({ message: "Uploading..." });
				if (selected.file.fsPath.endsWith('.hex')) {
					await uploadHexFile(selected.file, selectedBoard, selectedPort);
				} else {
					await uploadToArduino(selected.file, selectedBoard, selectedPort);
				}
				vscode.window.showInformationMessage('Upload successful!');
			} catch (error) {
				vscode.window.showErrorMessage(`Upload failed: ${error}`);
			}
		});
	});

	// 注册编译并上传命令
	const compileAndUploadCommand = vscode.commands.registerCommand('arduino-panda.compileAndUpload', async () => {
		// 优先使用当前活动编辑器中的文件
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && activeEditor.document.uri.fsPath.endsWith('.ino')) {
			const fileToProcess = activeEditor.document.uri;
			const config = vscode.workspace.getConfiguration('arduino-panda');
			const selectedBoard = config.get<string>('board');
			const selectedPort = config.get<string>('port');

			if (!selectedBoard || !selectedPort) {
				vscode.window.showErrorMessage('请先选择开发板和串口');
				return;
			}
			// 显示编译并上传进度
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Compiling and Uploading to Arduino",
				cancellable: false
			}, async (progress) => {
				progress.report({ message: "Compiling..." });
				await compileAndUpload(fileToProcess, selectedBoard, selectedPort);
				vscode.window.showInformationMessage('Compilation and Upload successful!');
			});
			return;
		}

		// 如果没有打开的文件，则搜索工作区
		const files = await vscode.workspace.findFiles('**/*.ino');
		if (files.length === 0) {
			vscode.window.showErrorMessage('No Arduino files found in workspace');
			return;
		}

		// 如果有多个文件，让用户选择要编译和上传的文件
		let fileToProcess: vscode.Uri;
		if (files.length === 1) {
			fileToProcess = files[0];
		} else {
			const fileItems = files.map(file => ({
				label: vscode.workspace.asRelativePath(file),
				file: file
			}));
			
			const selected = await vscode.window.showQuickPick(fileItems, {
				placeHolder: '选择要编译并上传的 Arduino 文件'
			});
			
			if (!selected) {
				return;
			}
			fileToProcess = selected.file;
		}

		// 获取当前配置
		const config = vscode.workspace.getConfiguration('arduino-panda');
		const selectedBoard = config.get<string>('board');
		const selectedPort = config.get<string>('port');

		if (!selectedBoard) {
			vscode.window.showErrorMessage('请先选择开发板');
			return;
		}
		if (!selectedPort) {
			vscode.window.showErrorMessage('请先选择串口');
			return;
		}

		// 显示进度
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "编译并上传 Arduino 代码",
			cancellable: false
		}, async (progress) => {
			try {
				progress.report({ message: "编译并上传中..." });
				await compileAndUpload(fileToProcess, selectedBoard, selectedPort);
				vscode.window.showInformationMessage('编译并上传成功！');
			} catch (error) {
				vscode.window.showErrorMessage(`编译并上传失败: ${error}`);
			}
		});
	});

	context.subscriptions.push(compileCommand, uploadCommand, compileAndUploadCommand);
}

export function deactivate() {}
