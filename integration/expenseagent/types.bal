
type Claim record {|
    string employee;
    string description;
    decimal amount;
|};

type Bill record {|
    string fileName;
    string fileUrl;
|};

type Reply record {|
    string message;
|};

type LineItem record {|
    string description;
    decimal amount;
|};

type BillDetails record {|
    string vendor;
    string date;
    decimal total;
    string currency;
    LineItem[] lineItems;
|};

type Decision record {|
    boolean approved;
    string comment;
|};

