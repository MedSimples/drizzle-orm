# Durable SQLite Cache Tests

This directory contains comprehensive tests for the `durable-sqlite-cache` driver, which extends the original `durable-sqlite` driver with full caching support.

## Test Files

### 1. `durable-sqlite-cache.test.ts`
**Basic functionality tests**
- Async database operations
- Migration support  
- Transaction handling
- Basic cache functionality
- Global cache behavior
- Cache invalidation on mutations
- Uses the common test suite from `sqlite-common.ts`

### 2. `durable-sqlite-cache-batch.test.ts`
**Batch operations and advanced scenarios**
- Async batch inserts, updates, deletes
- Batch operations with transactions
- Batch rollback behavior
- Cache integration with batch operations
- Complex multi-table batch operations
- Type safety verification for batch responses

### 3. `durable-sqlite-cache-specific.test.ts`
**Cache-specific functionality**
- Explicit cache usage with `$withCache()`
- Global cache strategy testing
- Cache invalidation mechanisms
- Custom cache configuration
- Manual cache invalidation via `$cache.invalidate()`
- Cache behavior with complex queries and joins
- Cache parameter differentiation
- Error handling with cache enabled

### 4. `durable-sqlite-cache-integration.test.ts`
**Real-world integration scenarios**
- Complete user registration/authentication flow
- Content management system simulation
- Session handling and cleanup
- Complex queries with aggregations
- Migration testing with cache
- Performance comparisons
- Error handling in production-like scenarios

## Test Coverage

### Core Functionality ✅
- [x] Async database operations (insert, select, update, delete)
- [x] Transaction support with proper rollback
- [x] Migration functionality
- [x] Batch operations
- [x] Error handling and constraint violations

### Cache Features ✅
- [x] Explicit caching with `$withCache()`
- [x] Global cache strategy
- [x] Automatic cache invalidation on mutations
- [x] Manual cache invalidation
- [x] Custom cache configuration (TTL, tags, etc.)
- [x] Cache with complex queries and joins
- [x] Cache with different query parameters
- [x] Cache integration with transactions
- [x] Cache integration with batch operations

### Real-world Scenarios ✅
- [x] User authentication flows
- [x] Content management patterns
- [x] Session management
- [x] Data cleanup operations
- [x] Performance testing
- [x] Migration workflows

## Running the Tests

```bash
# Run all durable-sqlite-cache tests
npm test -- durable-sqlite-cache

# Run specific test file
npm test -- durable-sqlite-cache.test.ts

# Run with coverage
npm test -- --coverage durable-sqlite-cache
```

## Key Test Patterns

### 1. Async/Await Pattern
All tests use async/await since the driver is fully asynchronous:
```typescript
const result = await db.select().from(table);
await db.insert(table).values(data);
```

### 2. Cache Testing Pattern
Tests verify cache behavior using spies on cache methods:
```typescript
const getCacheSpy = vi.spyOn(testCache, 'get');
const putCacheSpy = vi.spyOn(testCache, 'put');

await db.select().from(table).$withCache();

expect(getCacheSpy).toHaveBeenCalled();
expect(putCacheSpy).toHaveBeenCalled();
```

### 3. Transaction Testing Pattern
Tests verify proper transaction behavior:
```typescript
await db.transaction(async (tx) => {
  await tx.insert(table).values(data);
  // Operations within transaction
});
```

### 4. Error Handling Pattern
Tests verify errors are properly handled:
```typescript
await expect(
  db.insert(table).values(invalidData)
).rejects.toThrow();
```

## Dependencies

- **@miniflare/durable-objects**: Provides DurableObjectStorage for testing
- **@miniflare/storage-memory**: In-memory storage backend for tests
- **vitest**: Testing framework
- **TestCache/TestGlobalCache**: Cache implementations from `sqlite-common-cache.ts`

## Test Environment

Tests use in-memory storage to ensure:
- Fast test execution
- Isolated test cases
- No external dependencies
- Consistent behavior across environments

## Breaking Changes from Original durable-sqlite

The tests verify that the cache-enabled version maintains compatibility while adding async behavior:

- All database operations return Promises
- Transaction syntax remains similar but async
- Migration function is async
- Cache functionality is fully integrated

## Performance Considerations

Integration tests include performance comparisons demonstrating:
- Cache hit vs miss scenarios
- Cached vs non-cached query performance
- Batch operation efficiency
- Transaction overhead
