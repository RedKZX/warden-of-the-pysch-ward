const fs = require('fs');
const path = require('path');
const logs = require('../Logging/Logger');

const projectRoot = path.join(__dirname, '..', '..');

function countLines(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return fileContent.split('\n').length;
}

function countLinesInDirectory(dirPath) {
    let totalLines = 0;
    const files = fs.readdirSync(dirPath);

    const dirName = path.basename(dirPath);
    let dirLines = 0;

    files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);

        const excludedDirs = ['node_modules', '.git', 'dist', 'build'];
        const excludedFiles = ['package.json', 'package-lock.json', '.gitignore', 'README.md', 'logs.json'];

        if (stat.isDirectory() && !excludedDirs.includes(file)) {
            totalLines += countLinesInDirectory(filePath);
        } else if (stat.isFile() && !excludedFiles.includes(file)) {
            const lineCount = countLines(filePath);
            dirLines += lineCount;
            totalLines += lineCount;
        }
    });

    return totalLines;
}

const totalLines = countLinesInDirectory(projectRoot);
logs.count(`Total lines of code in project: ${totalLines}`);
