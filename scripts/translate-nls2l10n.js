const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_NLS_PATTERN = 'package.nls.*.json';
const L10N_DIR = path.join(PROJECT_ROOT, 'l10n');
const MAIN_NLS_FILE = path.join(PROJECT_ROOT, 'package.nls.json');

// Language mapping for file names
const LANGUAGE_MAPPING = {
    'zh-cn': 'zh-cn',
    'zh-tw': 'zh-tw', 
    'ja': 'ja'
};

/**
 * Safely read JSON file
 */
function readJsonFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Safely write JSON file with formatting
 */
function writeJsonFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const content = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing file ${filePath}:`, error.message);
        return false;
    }
}

/**
 * Merge two objects, preserving existing keys and adding new ones
 */
function mergeTranslations(existing, newTranslations) {
    const merged = { ...existing };
    let addedCount = 0;
    let updatedCount = 0;

    for (const [key, value] of Object.entries(newTranslations)) {
        if (!(key in merged)) {
            merged[key] = value;
            addedCount++;
        } else if (merged[key] !== value) {
            // Update existing key with new translation
            merged[key] = value;
            updatedCount++;
        }
    }

    return { merged, addedCount, updatedCount };
}

/**
 * Extract language code from package.nls filename
 */
function extractLanguageCode(filename) {
    const match = filename.match(/package\.nls\.(.+)\.json/);
    return match ? match[1] : null;
}

/**
 * Convert package.nls key to l10n bundle format
 * Preserves original dot notation as VS Code l10n expects
 */
function convertToBundleFormat(nlsData) {
    const bundleData = {};
    
    for (const [key, value] of Object.entries(nlsData)) {
        // Keep original dot notation for VS Code l10n compatibility
        bundleData[key] = value;
    }
    
    return bundleData;
}

/**
 * Process a single language file
 */
function processLanguageFile(nlsFilePath, languageCode) {
    console.log(`\nProcessing language: ${languageCode}`);
    
    const nlsData = readJsonFile(nlsFilePath);
    if (!nlsData) {
        console.error(`Failed to read ${nlsFilePath}`);
        return false;
    }

    // Convert to bundle format
    const bundleData = convertToBundleFormat(nlsData);
    
    // Determine target bundle filename
    const bundleFileName = languageCode === 'en' ? 'bundle.l10n.json' : `bundle.l10n.${languageCode}.json`;
    const bundleFilePath = path.join(L10N_DIR, bundleFileName);
    
    // Read existing bundle file if it exists
    let existingBundle = {};
    if (fs.existsSync(bundleFilePath)) {
        existingBundle = readJsonFile(bundleFilePath) || {};
        console.log(`Found existing bundle file: ${bundleFileName}`);
    } else {
        console.log(`Creating new bundle file: ${bundleFileName}`);
    }
    
    // Merge translations
    const { merged, addedCount, updatedCount } = mergeTranslations(existingBundle, bundleData);
    
    // Write merged result
    if (writeJsonFile(bundleFilePath, merged)) {
        console.log(`✓ Successfully updated ${bundleFileName}`);
        console.log(`  - Added ${addedCount} new translations`);
        console.log(`  - Updated ${updatedCount} existing translations`);
        console.log(`  - Total keys: ${Object.keys(merged).length}`);
        return true;
    } else {
        console.error(`✗ Failed to write ${bundleFileName}`);
        return false;
    }
}

/**
 * Main translation function
 */
function translatePackageNlsToL10n() {
    console.log('Starting package.nls.json to l10n translation...');
    console.log(`Project root: ${PROJECT_ROOT}`);
    console.log(`L10n directory: ${L10N_DIR}`);
    
    let successCount = 0;
    let totalCount = 0;
    
    // Process main package.nls.json (English)
    if (fs.existsSync(MAIN_NLS_FILE)) {
        console.log('\nProcessing main package.nls.json (English)');
        totalCount++;
        if (processLanguageFile(MAIN_NLS_FILE, 'en')) {
            successCount++;
        }
    }
    
    // Find and process language-specific package.nls files
    const files = fs.readdirSync(PROJECT_ROOT);
    const nlsFiles = files.filter(file => file.startsWith('package.nls.') && file.endsWith('.json') && file !== 'package.nls.json');
    
    console.log(`\nFound ${nlsFiles.length} language-specific package.nls files:`);
    nlsFiles.forEach(file => console.log(`  - ${file}`));
    
    for (const file of nlsFiles) {
        const languageCode = extractLanguageCode(file);
        if (languageCode) {
            totalCount++;
            const filePath = path.join(PROJECT_ROOT, file);
            if (processLanguageFile(filePath, languageCode)) {
                successCount++;
            }
        }
    }
    
    console.log(`\n=== Translation Complete ===`);
    console.log(`Successfully processed: ${successCount}/${totalCount} files`);
    
    if (successCount === totalCount) {
        console.log('✓ All translations completed successfully!');
    } else {
        console.log('⚠ Some translations failed. Check error messages above.');
        process.exit(1);
    }
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run the translation
if (require.main === module) {
    translatePackageNlsToL10n();
}

module.exports = { translatePackageNlsToL10n };