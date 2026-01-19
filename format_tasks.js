import fs from 'fs';

try {
    const rawData = fs.readFileSync('/home/hanzj/workspace/cologne_tasks.json', 'utf8');
    const data = JSON.parse(rawData);
    const issues = data.issues || [];
    
    let message = "📊 Cologne 项目未关闭任务清单 (共 " + issues.length + " 个):\n\n";
    
    issues.forEach((issue, index) => {
        const key = issue.key;
        const summary = issue.fields.summary;
        const status = issue.fields.status.name;
        message += `${index + 1}. [${key}] ${summary} (${status})\n`;
    });
    
    process.stdout.write(message);
} catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
}
