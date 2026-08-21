// Loaded before any test file, because TypeORM's decorators register through
// the metadata reflection API and a test imports an entity long before it
// imports anything that would have set this up.
import "reflect-metadata";
