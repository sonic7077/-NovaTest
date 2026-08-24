import { fileURLToPath } from 'node:url';
import { createDataPackage } from '../services/data-package-service.js';

export { createDataPackage } from '../services/data-package-service.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await createDataPackage();
    console.log(`data package created: ${result.archivePath}`);
    console.log(`database sha256: ${result.sha256}`);
  } catch (error) {
    console.error(`data package failed: ${error.message}`);
    process.exitCode = 1;
  }
}
