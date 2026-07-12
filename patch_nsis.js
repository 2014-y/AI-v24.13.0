const fs = require('fs');
const path = require('path');

function findNsh(dir) {
    let results = [];
    try {
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            file = path.join(dir, file);
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory() && !file.includes('.asar')) {
                results = results.concat(findNsh(file));
            } else {
                if (file.endsWith('installSection.nsh')) {
                    results.push(file);
                }
            }
        });
    } catch (e) {}
    return results;
}

try {
    console.log('Searching for installSection.nsh to patch SetDetailsPrint...');
    const files = findNsh(path.join(__dirname, 'node_modules'));
    let patched = false;
    files.forEach(file => {
        let data = fs.readFileSync(file, 'utf8');
        if (data.includes('SetDetailsPrint none')) {
            data = data.replace(/SetDetailsPrint none/g, 'SetDetailsPrint both');
            fs.writeFileSync(file, data);
            console.log(`Patched: ${file}`);
            patched = true;
        }
    });
    if (!patched) {
        console.log('No patching was necessary or file not found.');
    }
} catch (e) {
    console.error('Error patching NSIS:', e);
}
