import { useEffect, useId, useState } from "react";
import { T } from "gt-react";
import { create } from "zustand";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Request = {
  readonly mode: "create" | "rename";
  readonly initialName: string;
  readonly resolve: (name: string | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

/** Asks for a project group's name; resolves null when dismissed. */
export function requestProjectGroupName(input: {
  mode: "create" | "rename";
  initialName?: string;
}): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) =>
    useRequest.setState({
      request: { mode: input.mode, initialName: input.initialName ?? "", resolve },
    }),
  );
}

function finish(name: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function ProjectGroupNameDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves any pending name request promise with null when the dialog host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ProjectGroupNameDialog key={request.mode} request={request} /> : null;
}

function ProjectGroupNameDialog({ request }: { request: Request }) {
  const id = useId();
  const [name, setName] = useState(request.initialName);
  const trimmed = name.trim();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed !== "") finish(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {request.mode === "create" ? <T>New group</T> : <T>Rename group</T>}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>
                <T>Group name</T>
              </Label>
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              <T>Cancel</T>
            </Button>
            <Button type="submit" disabled={trimmed === ""}>
              {request.mode === "create" ? <T>Create</T> : <T>Rename</T>}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
