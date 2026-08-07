import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');
const serverDir = path.resolve(clientDir, '../server');

const findFreePort = async (startPort = 8002) => {
  for (let port = startPort; port < startPort + 50; port += 1) {
    const server = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      await new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
      return port;
    } catch {
      // try the next port
    }
  }

  throw new Error('Unable to find a free backend port');
};

const main = async () => {
  const backendPort = await findFreePort();
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const pythonBinary = path.join(serverDir, '.venv', 'bin', 'python3');
  const backendCommand = fs.existsSync(pythonBinary) ? pythonBinary : 'python3';

  const frontend = spawn(npmCommand, ['run', 'dev'], {
    cwd: clientDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_API_URL: `http://localhost:${backendPort}`,
    },
  });

  const backend = spawn(backendCommand, ['-m', 'uvicorn', 'app.main:app', '--reload', '--reload-dir', 'app', '--port', String(backendPort)], {
    cwd: serverDir,
    stdio: 'inherit',
    env: {
      ...process.env,
    },
  });

  const stopAll = () => {
    frontend.kill('SIGINT');
    backend.kill('SIGINT');
  };

  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);

  frontend.on('exit', code => {
    backend.kill('SIGINT');
    process.exit(code ?? 0);
  });

  backend.on('exit', code => {
    frontend.kill('SIGINT');
    process.exit(code ?? 0);
  });
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
