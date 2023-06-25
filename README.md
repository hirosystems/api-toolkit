# API Toolkit

The API Toolkit Library is a comprehensive collection of tools designed by Hiro to simplify common
tasks in API development. This library provides functionalities for database management, application
shutdown handlers, migration helpers, server version management, etc. It aims to streamline the
development process and improve code quality by offering convenient and reusable modules.

## Installation

You can start by installing the API Toolkit Library using npm:

```
npm install @hirosystems/api-toolkit
```

You should also set your application's name on an ENV variable so it can be reflected in log
messages and database connections:

```env
APPLICATION_NAME=your-api-name
```

## Featured tools

Please see each tool's source directory for additional documentation

### Postgres

* Superclass for connection support and SQL transaction management using [postgres.js](https://github.com/porsager/postgres)
* Connection helpers with automatic retry logic, using the standard postgres ENV variables
* Migration tools for migration apply and rollback using
  [node-pg-migrate](https://github.com/salsita/node-pg-migrate)
* Type definitions and conversion helpers for postgres to node type management and viceversa

### Shutdown handlers

* Node.js signal handlers that provide a way to shut down long-running application components
gracefully on unhandled exceptions or interrupt signals.

### Logger

* Standardized logger configuration using [pino](https://github.com/pinojs/pino)

### Server versioning

* JS executable tool to generate API versioning information based on Git branch, tag, and latest
  commit
* Helpers to extract version info to display at runtime or on documentation

## License

The API Toolkit Library is released under the Apache 2.0 License. See the LICENSE file for more
details.