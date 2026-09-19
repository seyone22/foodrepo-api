import { Module } from "@nestjs/common";
import { GraphTraversalService } from "./graph-traversal.service";

@Module({
  providers: [GraphTraversalService],
  exports: [GraphTraversalService],
})
export class GraphModule {}