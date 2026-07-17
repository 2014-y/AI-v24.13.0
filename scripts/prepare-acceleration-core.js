'use strict';

/**
 * Download the Windows acceleration binaries at build time so the installer
 * works without GitHub access on the user's machine.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const versions = require('../config/acceleration-core.json');
const targetArch = String(process.env.NEXORA_TARGET_ARCH || process.env.npm_config_arch || process.arch)
    .toLowerCase();
const nodeArch = targetArch === 'arm64' ? 'arm64' : 'x64';
const releaseArch = nodeArch === 'arm64' ? 'arm64' : 'amd64';
const outDir = path.join(ROOT, 'build-resources', 'acceleration-core', `win32-${nodeArch}`);
const tempDir = path.join(ROOT, 'build-resources', '_acceleration-core-download');

const mihomoAsset = `mihomo-windows-${releaseArch}-${versions.mihomoVersion}.zip`;
const mihomoUrl = `https://github.com/MetaCubeX/mihomo/releases/download/${versions.mihomoVersion}/${mihomoAsset}`;
const wintunAsset = `wintun-${versions.wintunVersion}.zip`;
const wintunUrl = `https://www.wintun.net/builds/${wintunAsset}`;
const geoipUrl = versions.geodata && versions.geodata.geoip;
const geositeUrl = versions.geodata && versions.geodata.geosite;

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isUsableBinary(file, signature, minSize) {
    try {
        const data = fs.readFileSync(file);
        return data.length >= minSize && data.subarray(0, signature.length).equals(signature);
    } catch (e) {
        return false;
    }
}

function isUsableDataFile(file, minSize) {
    try {
        return fs.existsSync(file) && fs.statSync(file).size >= minSize;
    } catch (e) {
        return false;
    }
}

function download(url, destination, redirects = 0) {
    if (redirects > 8) return Promise.reject(new Error(`Too many redirects: ${url}`));
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: { 'User-Agent': 'NexoraAgent-Build/2.0', Accept: '*/*' },
            timeout: 180000
        }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                const next = new URL(response.headers.location, url).toString();
                download(next, destination, redirects + 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }
            const temp = `${destination}.part`;
            const output = fs.createWriteStream(temp);
            response.pipe(output);
            output.on('finish', () => {
                output.close(() => {
                    fs.renameSync(temp, destination);
                    resolve(destination);
                });
            });
            output.on('error', (error) => {
                try { fs.rmSync(temp, { force: true }); } catch (e) {}
                reject(error);
            });
        });
        request.on('timeout', () => request.destroy(new Error(`Download timeout: ${url}`)));
        request.on('error', reject);
    });
}

function extractZip(zip, destination) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });

    const attempts = process.platform === 'win32'
        ? [
            ['powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command',
                `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`]],
            ['tar.exe', ['-xf', zip, '-C', destination]]
        ]
        : [['unzip', ['-o', zip, '-d', destination]]];

    for (const [command, args] of attempts) {
        const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
        if (!result.error && result.status === 0) return;
    }
    throw new Error(`Unable to extract ${path.basename(zip)}`);
}

function findFile(directory, matcher) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = findFile(full, matcher);
            if (nested) return nested;
        } else if (matcher(full)) {
            return full;
        }
    }
    return null;
}

async function ensureDownload(url, destination) {
    if (fs.existsSync(destination) && fs.statSync(destination).size > 1024) return;
    console.log(`[acceleration-core] Downloading ${path.basename(destination)}...`);
    await download(url, destination);
}

function writeManifest(files) {
    const notice = [
        'Nexora Agent bundled acceleration components',
        '',
        `mihomo ${versions.mihomoVersion}`,
        'Source and license: https://github.com/MetaCubeX/mihomo',
        '',
        `Wintun ${versions.wintunVersion}`,
        'Source and license: https://www.wintun.net/',
        '',
        'GeoIP / GeoSite (MetaCubeX meta-rules-dat)',
        'Source and license: https://github.com/MetaCubeX/meta-rules-dat',
        ''
    ].join('\r\n');
    fs.writeFileSync(path.join(outDir, 'THIRD_PARTY_NOTICES.txt'), notice, 'utf8');
    fs.writeFileSync(path.join(outDir, 'core-manifest.json'), JSON.stringify({
        schemaVersion: 2,
        platform: 'win32',
        arch: nodeArch,
        mihomoVersion: versions.mihomoVersion,
        wintunVersion: versions.wintunVersion,
        files
    }, null, 2), 'utf8');
}

async function main() {
    if (!geoipUrl || !geositeUrl) {
        throw new Error('config/acceleration-core.json missing geodata urls');
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const bundledMihomo = path.join(outDir, 'mihomo.exe');
    const bundledWintun = path.join(outDir, 'wintun.dll');
    const bundledGeoip = path.join(outDir, 'geoip.dat');
    const bundledGeosite = path.join(outDir, 'geosite.dat');
    const existingManifest = path.join(outDir, 'core-manifest.json');

    if (isUsableBinary(bundledMihomo, Buffer.from('MZ'), 1024 * 1024)
        && isUsableBinary(bundledWintun, Buffer.from('MZ'), 32 * 1024)
        && isUsableDataFile(bundledGeoip, 1024 * 1024)
        && isUsableDataFile(bundledGeosite, 100 * 1024)
        && fs.existsSync(existingManifest)) {
        const manifest = JSON.parse(fs.readFileSync(existingManifest, 'utf8'));
        if (manifest.schemaVersion >= 2
            && manifest.mihomoVersion === versions.mihomoVersion
            && manifest.wintunVersion === versions.wintunVersion
            && manifest.arch === nodeArch
            && manifest.files
            && manifest.files.mihomo
            && manifest.files.wintun
            && manifest.files.geoip
            && manifest.files.geosite
            && manifest.files.mihomo.sha256 === sha256(bundledMihomo)
            && manifest.files.wintun.sha256 === sha256(bundledWintun)
            && manifest.files.geoip.sha256 === sha256(bundledGeoip)
            && manifest.files.geosite.sha256 === sha256(bundledGeosite)) {
            console.log('[acceleration-core] Bundled binaries are current.');
            return;
        }
    }

    const mihomoZip = path.join(tempDir, mihomoAsset);
    const wintunZip = path.join(tempDir, wintunAsset);
    const geoipTmp = path.join(tempDir, 'geoip.dat');
    const geositeTmp = path.join(tempDir, 'geosite.dat');
    await ensureDownload(mihomoUrl, mihomoZip);
    await ensureDownload(wintunUrl, wintunZip);
    await ensureDownload(geoipUrl, geoipTmp);
    await ensureDownload(geositeUrl, geositeTmp);

    const mihomoExtract = path.join(tempDir, 'mihomo');
    const wintunExtract = path.join(tempDir, 'wintun');
    extractZip(mihomoZip, mihomoExtract);
    extractZip(wintunZip, wintunExtract);

    const mihomoSource = findFile(mihomoExtract, (file) => /^mihomo.*\.exe$/i.test(path.basename(file)));
    const wintunArchPart = path.join('bin', releaseArch).toLowerCase();
    const wintunSource = findFile(wintunExtract, (file) =>
        path.basename(file).toLowerCase() === 'wintun.dll'
        && file.toLowerCase().includes(wintunArchPart));
    if (!mihomoSource || !isUsableBinary(mihomoSource, Buffer.from('MZ'), 1024 * 1024)) {
        throw new Error('Downloaded mihomo archive does not contain a valid Windows executable');
    }
    if (!wintunSource || !isUsableBinary(wintunSource, Buffer.from('MZ'), 32 * 1024)) {
        throw new Error(`Downloaded Wintun archive does not contain a valid ${releaseArch} DLL`);
    }
    if (!isUsableDataFile(geoipTmp, 1024 * 1024)) {
        throw new Error('Downloaded geoip.dat is invalid');
    }
    if (!isUsableDataFile(geositeTmp, 100 * 1024)) {
        throw new Error('Downloaded geosite.dat is invalid');
    }

    fs.copyFileSync(mihomoSource, bundledMihomo);
    fs.copyFileSync(wintunSource, bundledWintun);
    fs.copyFileSync(geoipTmp, bundledGeoip);
    fs.copyFileSync(geositeTmp, bundledGeosite);

    writeManifest({
        mihomo: { name: 'mihomo.exe', sha256: sha256(bundledMihomo) },
        wintun: { name: 'wintun.dll', sha256: sha256(bundledWintun) },
        geoip: { name: 'geoip.dat', sha256: sha256(bundledGeoip), minSize: 1024 * 1024 },
        geosite: { name: 'geosite.dat', sha256: sha256(bundledGeosite), minSize: 100 * 1024 }
    });

    console.log(`[acceleration-core] Ready: ${outDir}`);
}

main().catch((error) => {
    console.error(`[acceleration-core] ${error.stack || error.message || error}`);
    process.exitCode = 1;
});
