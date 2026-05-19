import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SkillListProps = {
  title: string;
  description: string;
  items: string[];
  emptyText: string;
};

export function SkillList({ title, description, items, emptyText }: SkillListProps) {
  return (
    <Card className="bg-white/85">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <Badge key={item} className="border-teal-200 bg-teal-50 text-teal-800" variant="outline">
                {item}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">{emptyText}</p>
        )}
      </CardContent>
    </Card>
  );
}
