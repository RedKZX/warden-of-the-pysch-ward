module.exports = {
  getStartupBanner: (version = "5") => {

    const versionText = `VERSION: ${version}`;
    const authorText = 'MADE BY: henreh';

    const versionPadding = Math.floor((63 - versionText.length) / 2);
    const authorPadding = Math.floor((63 - authorText.length) / 2);
    
    const versionLine = '║' + ' '.repeat(versionPadding) + versionText + ' '.repeat(63 - versionText.length - versionPadding) + '║';
    const authorLine = '║' + ' '.repeat(authorPadding) + authorText + ' '.repeat(63 - authorText.length - authorPadding) + '║';
    
    return `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     WEIIIIII
╟───────────────────────────────────────────────────────────────╢
║                                                               ║
${versionLine}
${authorLine}
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`;
  },
  
  getProgressBar: (current, total, width = 30) => {
    const percentage = Math.floor((current / total) * 100);
    const filledWidth = Math.floor((current / total) * width);
    const emptyWidth = width - filledWidth;
    
    const filled = '█'.repeat(filledWidth);
    const empty = '░'.repeat(emptyWidth);
    
    return `[${filled}${empty}] ${percentage}%`;
  }
};
