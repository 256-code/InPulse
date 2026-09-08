import { Module } from "@nestjs/common";
import { FeatureQueryPort } from "./feature-query.port.js";
import { PostgresFeatureQueryPort } from "./postgres-feature-query-port.js";

@Module({
  providers: [
    { provide: FeatureQueryPort, useClass: PostgresFeatureQueryPort },
  ],
  exports: [FeatureQueryPort],
})
export class FeaturesModule {}
