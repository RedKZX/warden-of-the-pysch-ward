const readline = require('node:readline');
const { exec } = require('node:child_process');

module.exports = async function Prompt(question = '') {
    if (typeof question !== 'string') throw new Error('Question must be a string');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: question
    });

    let lastPaste = 0;
    const PASTE_DELAY = 100;

    rl.setPrompt(question);

    process.stdin.on('keypress', async (_, key) => {
        if (key && key.ctrl && key.name === 'v') {
            const now = Date.now();
            if (now - lastPaste < PASTE_DELAY) {
                return; 
            }
            lastPaste = now;

            exec('powershell.exe Get-Clipboard', (error, stdout) => {
                if (!error) {
                    const content = stdout.trim();
                    rl.write(null, { ctrl: true, name: 'u' }); 
                    process.stdout.write('\r' + question);
                    rl.write(content);
                }
            });
        }
    });

    try {
        return await new Promise(resolve => {
            rl.question(question, answer => {
                resolve(answer);
            });
        });
    } finally {
        rl.close();
    }
}
