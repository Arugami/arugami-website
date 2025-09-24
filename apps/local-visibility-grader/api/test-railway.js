// Simple test to see if Railway can run from this directory
console.log('Railway test script running from:', process.cwd());
console.log('Environment variables available:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- GOOGLE_MAPS_API_KEY:', process.env.GOOGLE_MAPS_API_KEY ? 'Present' : 'Missing');

// Test basic HTTP server
import { createServer } from 'http';

const port = process.env.PORT || 3000;
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'Railway test OK', 
    cwd: process.cwd(),
    timestamp: new Date().toISOString()
  }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Railway test server running on port ${port}`);
});
