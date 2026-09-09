import { Module } from "@nestjs/common";
import { FeatureReadPort } from "./feature-read.port.js";
import { PostgresFeatureReadPort } from "./postgres-feature-read-port.js";
import { FeatureQueryPort } from "./feature-query.port.js";
import { PostgresFeatureQueryPort } from "./postgres-feature-query-port.js";

@Module({
  providers: [
    { provide: FeatureReadPort, useClass: PostgresFeatureReadPort },
    { provide: FeatureQueryPort, useClass: PostgresFeatureQueryPort },
  ],
  exports: [FeatureQueryPort, FeatureReadPort],
})
export class FeaturesModule {}
