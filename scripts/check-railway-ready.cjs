#!/usr/bin/env node
/**
 * Railway Deployment Readiness Check
 * Run this before deploying to Railway to verify configuration
 */

const fs = require('fs');
const path = require('path');

console.log('\n🚂 PackPTS Railway Deployment Readiness Check\n');
console.log('='.repeat(60));

let allChecks = true;

// Check 1: Required files exist
console.log('\n📁 Checking deployment files...');
const requiredFiles = [
  'railway.json',
  'nixpacks.toml',
  'package.json',
  'server/index.ts',
  'script/build.ts'
];

requiredFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, '..', file));
  if (exists) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - MISSING`);
    allChecks = false;
  }
});

// Check 2: package.json scripts
console.log('\n📦 Checking npm scripts...');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const requiredScripts = {
  'build': 'Required for Railway build phase',
  'start': 'Required for Railway start command',
  'db:push': 'Required for database migrations'
};

Object.entries(requiredScripts).forEach(([script, reason]) => {
  if (pkg.scripts[script]) {
    console.log(`  ✅ npm run ${script} - ${reason}`);
  } else {
    console.log(`  ❌ npm run ${script} - MISSING (${reason})`);
    allChecks = false;
  }
});

// Check 3: Dependencies
console.log('\n📚 Checking critical dependencies...');
const criticalDeps = [
  'express',
  'pg',
  'drizzle-orm',
  'tsx',
  'stripe',
  '@workos-inc/node',
  'ffmpeg-static'
];

criticalDeps.forEach(dep => {
  const inDeps = pkg.dependencies && pkg.dependencies[dep];
  const inDevDeps = pkg.devDependencies && pkg.devDependencies[dep];

  if (inDeps || inDevDeps) {
    const location = inDeps ? 'dependencies' : 'devDependencies';
    const warning = inDevDeps && dep === 'tsx' ? ' ⚠️  Should be in dependencies!' : '';
    console.log(`  ✅ ${dep} (${location})${warning}`);
  } else {
    console.log(`  ❌ ${dep} - MISSING`);
    allChecks = false;
  }
});

// Check 4: Environment variables template
console.log('\n🔐 Checking environment template...');
if (fs.existsSync(path.join(__dirname, '..', '.env.railway.example'))) {
  console.log('  ✅ .env.railway.example exists');
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.railway.example'), 'utf8');

  const criticalVars = [
    'DATABASE_URL',
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY',
    'WORKOS_API_KEY',
    'WORKOS_CLIENT_ID',
    'APP_URL',
    'NODE_ENV'
  ];

  criticalVars.forEach(varName => {
    if (envExample.includes(varName)) {
      console.log(`    ✅ ${varName}`);
    } else {
      console.log(`    ❌ ${varName} - Not in template`);
      allChecks = false;
    }
  });
} else {
  console.log('  ❌ .env.railway.example - MISSING');
  console.log('     Run the deployment setup script first!');
  allChecks = false;
}

// Check 5: Build output
console.log('\n🏗️  Checking build configuration...');
const buildScript = pkg.scripts.build;
if (buildScript && buildScript.includes('build.ts')) {
  console.log('  ✅ Uses custom build script (script/build.ts)');
} else {
  console.log('  ⚠️  Build script may not produce dist/ folder');
}

// Check 6: Port configuration
console.log('\n🌐 Checking port configuration...');
const indexContent = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.ts'), 'utf8');
if (indexContent.includes('process.env.PORT')) {
  console.log('  ✅ Server uses process.env.PORT (Railway compatible)');
} else {
  console.log('  ⚠️  Server may not read PORT from environment');
}

// Final summary
console.log('\n' + '='.repeat(60));
if (allChecks) {
  console.log('\n✅ All checks passed! Ready for Railway deployment.\n');
  console.log('Next steps:');
  console.log('1. Push to GitHub: git push');
  console.log('2. Create Railway project: https://railway.app/new');
  console.log('3. Add PostgreSQL service');
  console.log('4. Configure environment variables from .env.railway.example');
  console.log('5. Deploy!');
  console.log('\nFull guide: See RAILWAY_DEPLOYMENT.md\n');
  process.exit(0);
} else {
  console.log('\n❌ Some checks failed. Fix the issues above before deploying.\n');
  process.exit(1);
}
